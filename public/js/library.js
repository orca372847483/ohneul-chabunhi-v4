// 개인 자료함: 연도·시험 종류별 정렬, 영역/지문 유형 필터, 검색, 즐겨찾기, 최근 푼 자료, 지문 모아보기
import { dbx } from './db.js';
import { h, lsGet, lsSet, EXAMS, EXAM_ORDER, examLabel, fmtDur, fmtDate, toast } from './util.js';
import { CATEGORIES } from './classify.js';
import { updateDoc } from './docs.js';
import { addFiles, runAnalyze, editDocInfo, deleteDoc, connectFile, yearOptions } from './actions.js';
import { editPassage, tagChips, confText, qRange, pageRange } from './passages.js';
import { on, emit } from './events.js';
import { fetchPdfInto } from './collect.js';

const F = Object.assign({ mode: 'docs', q: '', year: '', exam: '', cat: '', fav: false, sort: 'year-desc' }, lsGet('lib-v4', {}));
const $ = (id) => document.getElementById(id);
let docs = [], passages = [], openDoc = () => {}, years = new Set();

const SRC = { upload: '내 PDF', collect: '공식 수집', migrated: 'v3에서 가져옴', sync: '동기화' };

export function initLibrary({ onOpen }) {
  openDoc = onOpen;
  $('libSort').value = F.sort; $('libQ').value = F.q; $('libFav').classList.toggle('on', F.fav);
  $('libMode').querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.m === F.mode); b.onclick = () => { F.mode = b.dataset.m; save(); }; });
  $('libQ').oninput = () => { F.q = $('libQ').value.trim(); save(false); };
  $('libYear').onchange = () => { F.year = $('libYear').value; save(); };
  $('libSort').onchange = () => { F.sort = $('libSort').value; save(); };
  $('libFav').onclick = () => { F.fav = !F.fav; $('libFav').classList.toggle('on', F.fav); save(); };
  $('libAdd').onclick = () => $('fileIn').click();
  $('fileIn').onchange = async (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) await addFiles(fs); };
  on('data', () => { if (!$('v-lib').hidden) refresh(); });
}
function save(rebuild = true) { lsSet('lib-v4', F); $('libMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === F.mode)); render(rebuild); }

export async function refresh() { [docs, passages] = await Promise.all([dbx.all('docs'), dbx.all('passages')]); render(true); }

function chip(text, on, fn) { return h('button', { class: 'chip' + (on ? ' on' : ''), text, onclick: fn }); }

function tagsOf(docId) { return passages.filter((p) => p.docId === docId); }

function render(rebuildFilters = true) {
  if (rebuildFilters) {
    const ys = [...new Set(docs.map((d) => d.year).filter(Boolean))].sort((a, b) => b - a);
    const sel = $('libYear'); sel.replaceChildren(h('option', { value: '', text: '전체 학년도' }), ys.map((y) => h('option', { value: y, text: `${y}학년도` })));
    sel.value = ys.includes(+F.year) ? F.year : ''; if (sel.value === '') F.year = '';
    $('libExam').replaceChildren(chip('전체', !F.exam, () => { F.exam = ''; save(); }), Object.entries(EXAMS).map(([k, t]) => chip(t, F.exam === k, () => { F.exam = F.exam === k ? '' : k; save(); })));
    const counts = {}; for (const p of passages) for (const t of p.tags || []) counts[t.label] = (counts[t.label] || 0) + 1;
    const unc = passages.filter((p) => !p.tags?.length).length;
    $('libCat').replaceChildren(h('span', { class: 'muted', text: '지문 유형', style: 'align-self:center' }), chip('전체', !F.cat, () => { F.cat = ''; save(); }),
      CATEGORIES.map((c) => chip(`${c}${counts[c] ? ' ' + counts[c] : ''}`, F.cat === c, () => { F.cat = F.cat === c ? '' : c; save(); })),
      unc ? chip(`미분류 ${unc}`, F.cat === '미분류', () => { F.cat = F.cat === '미분류' ? '' : '미분류'; save(); }) : null);
  }
  if (F.mode === 'passages') return renderPassages();
  renderDocs();
}

const passMatchesCat = (p) => !F.cat || (F.cat === '미분류' ? !p.tags?.length : (p.tags || []).some((t) => t.label === F.cat));
function docOk(d) {
  if (F.fav && !d.favorite) return false;
  if (F.year && d.year !== +F.year) return false;
  if (F.exam && d.exam !== F.exam) return false;
  if (F.cat && !tagsOf(d.id).some(passMatchesCat)) return false;
  if (F.q) {
    const q = F.q.toLowerCase();
    if (!(`${d.title} ${examLabel(d)} ${d.year || ''}`.toLowerCase().includes(q) || tagsOf(d.id).some((p) => `${p.heading} ${p.preview} ${(p.tags || []).map((t) => t.label).join(' ')}`.toLowerCase().includes(q)))) return false;
  }
  return true;
}
const sorters = {
  'year-desc': (a, b) => (b.year || 0) - (a.year || 0) || (EXAM_ORDER[a.exam] ?? 9) - (EXAM_ORDER[b.exam] ?? 9) || (a.month || 0) - (b.month || 0),
  'year-asc': (a, b) => (a.year || 0) - (b.year || 0) || (EXAM_ORDER[a.exam] ?? 9) - (EXAM_ORDER[b.exam] ?? 9) || (a.month || 0) - (b.month || 0),
  exam: (a, b) => (EXAM_ORDER[a.exam] ?? 9) - (EXAM_ORDER[b.exam] ?? 9) || (b.year || 0) - (a.year || 0) || (a.month || 0) - (b.month || 0),
  opened: (a, b) => (b.openedAt || 0) - (a.openedAt || 0),
  added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
  solve: (a, b) => (b.solveSec || 0) - (a.solveSec || 0),
};

function docCard(d, { compact = false } = {}) {
  const ps = tagsOf(d.id);
  const primaries = [...new Set(ps.flatMap((p) => (p.tags || []).map((t) => t.label)))].slice(0, 8);
  const need = ps.filter((p) => !p.tags?.length).length;
  const star = h('button', { class: 'star' + (d.favorite ? ' on' : ''), text: d.favorite ? '★' : '☆', 'aria-label': '즐겨찾기', onclick: async (e) => { e.stopPropagation(); await updateDoc(d.id, { favorite: !d.favorite }); emit('data'); } });
  const meta = [`${d.pages || '?'}쪽`, SRC[d.source] || '', d.solveSec ? `풀이 ${fmtDur(d.solveSec)}${d.solveCount ? ` · ${d.solveCount}회` : ''}` : '', d.openedAt ? `최근 ${fmtDate(d.openedAt)}` : ''].filter(Boolean).join(' · ');
  const analysis = d.analysis ? `지문 ${d.analysis.passages}개${need ? ` · 분류 필요 ${need}` : ''}` : d.hasFile ? '아직 분석 전' : '';
  const acts = d.hasFile
    ? [h('button', { class: 'btn sm primary', text: '열기', onclick: () => openDoc(d.id) }),
       h('button', { class: 'btn sm', text: d.analysis ? '다시 분석' : '분석', onclick: () => runAnalyze(d.id) }),
       h('button', { class: 'btn sm', text: '정보', onclick: () => editDocInfo(d) }),
       h('button', { class: 'btn sm danger', text: '삭제', onclick: () => deleteDoc(d) })]
    : [h('span', { class: 'st err', text: '이 기기에 PDF 없음' }),
       d.sourceUrl && /\.pdf(\?|$)/i.test(d.sourceUrl) ? h('button', { class: 'btn sm primary', text: '공식 출처에서 다시 받기', onclick: async () => { const r = await fetchPdfInto({ url: d.sourceUrl, title: d.title, year: d.year, exam: d.exam, month: d.month, pageUrl: d.pageUrl }); if (r?.ok) emit('data'); } }) : null,
       h('button', { class: 'btn sm', text: '내 PDF 연결', onclick: () => pick((f) => connectFile(d, f)) }),
       d.pageUrl ? h('a', { class: 'btn sm', href: d.pageUrl, target: '_blank', rel: 'noopener', text: '공식 페이지 ↗' }) : null,
       h('button', { class: 'btn sm danger', text: '삭제', onclick: () => deleteDoc(d) })];
  return h('div', { class: 'card doc', onclick: compact ? () => d.hasFile && openDoc(d.id) : null },
    h('div', { class: 't' }, h('span', { text: d.title }), star),
    h('div', { class: 'meta', text: meta }),
    analysis ? h('div', { class: 'meta', text: analysis }) : null,
    primaries.length ? h('div', { class: 'chips' }, primaries.map((t) => h('span', { class: 'chip tag', text: t }))) : null,
    compact ? null : h('div', { class: 'acts' }, acts));
}

function pick(fn) { const i = h('input', { type: 'file', accept: 'application/pdf,.pdf' }); i.onchange = () => i.files[0] && fn(i.files[0]); i.click(); }

function renderDocs() {
  const body = $('libBody'), rec = $('libRecent');
  const list = docs.filter(docOk).sort(sorters[F.sort] || sorters['year-desc']);
  const noFilter = !F.q && !F.year && !F.exam && !F.cat && !F.fav;
  const recent = docs.filter((d) => d.openedAt && d.hasFile).sort(sorters.opened).slice(0, 4);
  rec.replaceChildren();
  if (noFilter && recent.length) rec.append(h('h3', { text: '최근 푼 자료' }), h('div', { class: 'recent' }, recent.map((d) => docCard(d, { compact: true }))));
  if (!docs.length) { body.replaceChildren(h('div', { class: 'empty' }, h('b', { text: '자료함이 비어 있어요' }), h('br'), '‘기출 찾기’에서 공식 출처의 PDF를 추가하거나, ‘내 PDF 추가’로 가진 파일을 불러오세요.', h('div', { style: 'margin-top:12px' }, h('a', { class: 'btn primary', href: '#/collect', text: '기출 찾기로 이동' })))); return; }
  if (!list.length) { body.replaceChildren(h('div', { class: 'empty', text: '조건에 맞는 자료가 없어요' })); return; }
  body.replaceChildren(h('div', { class: 'muted', style: 'margin-bottom:6px', text: `자료 ${list.length}개` }), h('div', { class: 'docs' }, list.map((d) => docCard(d))));
}

function renderPassages() {
  $('libRecent').replaceChildren();
  const byId = new Map(docs.map((d) => [d.id, d]));
  const q = F.q.toLowerCase();
  const list = passages.filter((p) => {
    const d = byId.get(p.docId); if (!d || !docOk0(d)) return false;
    if (!passMatchesCat(p)) return false;
    return !q || `${p.heading} ${p.preview} ${d.title}`.toLowerCase().includes(q);
  }).sort((a, b) => sorters[F.sort === 'opened' || F.sort === 'added' || F.sort === 'solve' ? 'year-desc' : F.sort](byId.get(a.docId), byId.get(b.docId)) || a.pageFrom - b.pageFrom);
  const body = $('libBody');
  if (!passages.length) { body.replaceChildren(h('div', { class: 'empty', text: '분류된 지문이 없어요. 자료를 추가하면 자동으로 지문을 나누고 분류해요.' })); return; }
  if (!list.length) { body.replaceChildren(h('div', { class: 'empty', text: '조건에 맞는 지문이 없어요' })); return; }
  body.replaceChildren(h('div', { class: 'muted', style: 'margin-bottom:6px', text: `지문 ${list.length}개 · 눌러서 해당 시험지 쪽으로 이동` }), h('div', { class: 'plist' }, list.map((p) => {
    const d = byId.get(p.docId);
    return h('div', { class: 'card prow', onclick: () => d.hasFile ? openDoc(d.id, p.pageFrom) : toast('이 기기에 PDF가 없어요. 자료에서 PDF를 연결하세요', 'error') },
      h('div', {}, h('b', { text: d.title }), h('span', { class: 'muted', text: `  ${qRange(p)} · ${pageRange(p)}` })),
      h('button', { class: 'btn sm', text: '분류 수정', onclick: (e) => { e.stopPropagation(); editPassage(p, () => refresh()); } }),
      h('div', { class: 'chips' }, tagChips(p), h('span', { class: 'muted', text: confText(p) })),
      h('div', { class: 'pv', text: p.preview || '' }));
  })));
}
function docOk0(d) { // 지문 모아보기에서는 지문 유형 필터를 지문 단위로 적용한다
  if (F.fav && !d.favorite) return false;
  if (F.year && d.year !== +F.year) return false;
  if (F.exam && d.exam !== F.exam) return false;
  return true;
}
void yearOptions;
