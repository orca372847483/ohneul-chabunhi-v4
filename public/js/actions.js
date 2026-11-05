// 여러 화면이 함께 쓰는 동작: 파일 추가, 분석 실행, 정보 수정, 삭제
import { h, toast, EXAMS, docTitle, latestYear, fmtDur } from './util.js';
import { modal, confirmBox } from './ui.js';
import { addPdf, guessMeta, updateDoc, removeDoc, attachFile } from './docs.js';
import { analyzeDoc } from './analyze.js';
import { emit } from './events.js';

let busyEl = null;
export function setBusy(text) {
  if (!busyEl) { busyEl = h('div', { class: 'pill busy', style: 'position:fixed;left:12px;bottom:12px;z-index:70;background:#fff' }); document.body.append(busyEl); }
  busyEl.hidden = !text; busyEl.textContent = text || '';
}

export function yearOptions(sel, { all = false, selected } = {}) {
  sel.replaceChildren();
  if (all) sel.append(h('option', { value: '', text: '전체 학년도' }));
  for (let y = latestYear(); y >= 2005; y--) sel.append(h('option', { value: y, text: `${y}학년도` }));
  if (selected != null) sel.value = selected;
}

function metaForm(m) {
  const year = h('select', { id: 'mYear' }); yearOptions(year, { selected: m.year || latestYear() - 1 });
  const exam = h('select', { id: 'mExam' }, Object.entries(EXAMS).map(([v, t]) => h('option', { value: v, text: t })), h('option', { value: '', text: '기타' }));
  exam.value = m.exam ?? 'csat';
  const month = h('select', { id: 'mMonth' }, h('option', { value: '', text: '월 미지정' }), [3, 4, 5, 6, 7, 9, 10, 11].map((x) => h('option', { value: x, text: x + '월' })));
  month.value = m.month || '';
  const title = h('input', { type: 'text', id: 'mTitle', value: m.title || '', placeholder: '비워 두면 자동으로 이름을 붙여요' });
  const sync = () => { month.parentElement.hidden = exam.value !== 'office'; };
  exam.addEventListener('change', sync);
  const f = (l, el) => h('div', { class: 'field' }, h('label', { text: l }), el);
  const root = h('div', {}, f('학년도', year), f('시험 종류', exam), f('교육청 시행 월', month), f('제목', title));
  sync();
  return { root, read: () => ({ year: +year.value || null, exam: exam.value || null, month: exam.value === 'office' ? +month.value || null : null, title: title.value.trim() }) };
}

/** 정보 수정 모달 */
export function editDocInfo(doc) {
  const form = metaForm({ year: doc.year, exam: doc.exam, month: doc.month, title: doc.title });
  modal({
    title: '자료 정보 수정', body: form.root,
    actions: [{ label: '취소' }, { label: '저장', primary: true, onClick: async () => {
      const v = form.read(); v.title = v.title || docTitle(v);
      await updateDoc(doc.id, v); emit('data'); toast('저장했어요');
    } }],
  });
}

function askMeta(fileName) {
  return new Promise((resolve) => {
    const g = guessMeta(fileName);
    const form = metaForm({ ...g, title: '' });
    const body = h('div', {}, h('div', { class: 'muted', text: `파일: ${fileName}` }), h('div', { class: 'muted', text: '연도·시험 종류는 파일 이름에서 추측한 값이에요. 맞는지 확인하세요(지문 분류에는 쓰이지 않아요).' }), form.root);
    let done = false;
    modal({ title: '자료 정보', body, onClose: () => { if (!done) resolve(null); }, actions: [{ label: '건너뛰기' }, { label: '추가', primary: true, onClick: () => { done = true; resolve(form.read()); } }] });
  });
}

export async function confirmOcr({ scanned, total }) {
  return confirmBox(`이 PDF는 ${total}쪽 중 ${scanned.length}쪽에 글자 정보가 없는 스캔본이에요.\n지문 분류를 하려면 OCR(글자 인식)이 필요해요. 인터넷으로 OCR 엔진(약 수십 MB)을 내려받고, 기기에서 처리해요. 시간이 꽤 걸릴 수 있어요.\n\nOCR을 실행할까요? (취소하면 수동 분류만 가능)`, { ok: 'OCR 실행', cancel: '건너뛰기' });
}

export async function runAnalyze(docId, { quiet = false } = {}) {
  try {
    setBusy('분석 시작…');
    const a = await analyzeDoc(docId, { onProgress: (m, n, t) => setBusy(`${m}${t ? ` ${n}/${t}` : ''}…`), confirmOcr });
    if (!quiet) toast(`지문 ${a.passages}개 · 자동 분류 ${a.auto}개 · 수동 분류 필요 ${a.needsManual}개`, a.passages ? 'info' : 'error', 6000);
    a.note.forEach((n) => toast(n, 'info', 7000));
    return a;
  } catch (e) { toast(`분석하지 못했어요: ${e.message}`, 'error', 9000); return null; }
  finally { setBusy(''); emit('data'); }
}

/** 내 PDF 파일 추가(여러 개 가능). 중복은 건너뛴다 */
export async function addFiles(files) {
  const added = [];
  for (const f of files) {
    try {
      const meta = await askMeta(f.name);
      if (!meta) continue;
      setBusy(`${f.name} 저장 중…`);
      const r = await addPdf(await f.arrayBuffer(), { ...meta, title: meta.title || undefined, source: 'upload', fileName: f.name });
      if (r.dup) { toast(`${r.doc.title}: ${r.reason}`, 'info', 5500); continue; }
      added.push(r.doc);
      emit('data');
      toast(`“${r.doc.title}” 추가 완료 (${r.doc.pages}쪽)`);
      await runAnalyze(r.doc.id, { quiet: true });
    } catch (e) { toast(`${f.name}: ${e.message}`, 'error', 8000); }
    finally { setBusy(''); }
  }
  emit('data');
  return added;
}

export async function connectFile(doc, file) {
  try {
    setBusy('PDF 연결 중…');
    const r = await attachFile(doc.id, await file.arrayBuffer());
    toast(r.differs ? '연결했어요. 원래 자료와 파일 내용이 달라 판본이 다를 수 있어요' : '연결했어요', r.differs ? 'info' : 'info', 6000);
    await runAnalyze(doc.id, { quiet: true });
  } catch (e) { toast(e.message, 'error', 7000); } finally { setBusy(''); emit('data'); }
}

export async function deleteDoc(doc) {
  const ok = await confirmBox(`“${doc.title}”을(를) 삭제할까요?\nPDF와 이 자료의 필기·메모·지문 분류·책갈피가 지워져요. 되돌릴 수 없어요.\n(공부 시간 기록 ${fmtDur(doc.solveSec || 0)}은 달력에 그대로 남아요)`, { ok: '삭제', danger: true });
  if (!ok) return false;
  await removeDoc(doc.id); emit('doc-deleted', doc.id); emit('data'); toast('삭제했어요'); return true;
}
