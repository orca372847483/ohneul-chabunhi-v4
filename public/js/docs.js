// 자료(문서) 추가·조회·수정·삭제. 중복 방지의 중심.
import { dbx, saveDoc, deleteDocCascade } from './db.js';
import { sha256, uid, docTitle } from './util.js';
import { loadPdf, destroyPdf } from './pdfjs.js';

/** 파일명은 메타데이터의 "초기 추측"에만 쓴다(지문 분류에는 쓰지 않는다). */
export function guessMeta(name = '') {
  const y = name.match(/(20[0-3]\d)/);
  const month = (name.match(/(\d{1,2})\s*월/) || [])[1];
  let exam = null;
  if (/6\s*월.*모의|6모|jun/i.test(name)) exam = 'jun';
  else if (/9\s*월.*모의|9모|sep/i.test(name)) exam = 'sep';
  else if (/학력평가|학평|교육청|전국연합/.test(name)) exam = 'office';
  else if (/수능|대학수학능력|csat/i.test(name)) exam = 'csat';
  return { year: y ? +y[1] : null, exam, month: exam === 'office' && month ? +month : null };
}

const head = (buf) => new TextDecoder('latin1').decode(new Uint8Array(buf.slice(0, 1024)));

/**
 * PDF 를 자료함에 저장한다.
 * @returns {{doc, dup:boolean, reason?:string, attached?:boolean}}
 */
export async function addPdf(buf, meta = {}) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 100) throw new Error('빈 파일이거나 너무 작아서 PDF가 아니에요');
  if (!head(buf).includes('%PDF')) throw new Error('PDF 파일이 아니에요(파일 머리말에 %PDF 표지가 없음). 로그인 페이지가 내려받아졌을 수도 있어요');
  const hash = await sha256(buf);
  const docs = await dbx.all('docs');

  const same = docs.find((d) => d.hasFile && d.hash === hash);
  if (same) return { doc: same, dup: true, reason: '같은 파일이 이미 자료함에 있어요' };
  if (meta.sourceUrl) {
    const bySrc = docs.find((d) => d.hasFile && d.sourceUrl === meta.sourceUrl);
    if (bySrc) return { doc: bySrc, dup: true, reason: '같은 출처 주소의 자료가 이미 있어요' };
  }

  const pdf = await loadPdf(buf); // 열 수 없는 파일은 여기서 걸러진다
  const pages = pdf.numPages;
  destroyPdf(pdf);

  // 다른 기기에서 동기화로 들어온 "파일 없는 자료"와 연결(같은 출처 주소 또는 같은 해시)
  const stub = docs.find((d) => !d.hasFile && ((meta.sourceUrl && d.sourceUrl === meta.sourceUrl) || (d.hash && d.hash === hash)));
  const now = Date.now();
  const doc = stub || { id: uid(), addedAt: now, favorite: false, solveSec: 0, solveCount: 0, openedAt: 0 };
  Object.assign(doc, {
    title: stub?.title || meta.title || docTitle(meta),
    year: stub?.year ?? meta.year ?? null, exam: stub?.exam ?? meta.exam ?? null, month: stub?.month ?? meta.month ?? null,
    subject: meta.subject || stub?.subject || '국어',
    source: meta.source || stub?.source || 'upload', sourceName: meta.sourceName || stub?.sourceName || null,
    sourceUrl: meta.sourceUrl || stub?.sourceUrl || null, pageUrl: meta.pageUrl || stub?.pageUrl || null,
    fileName: meta.fileName || stub?.fileName || null,
    hash, size: buf.byteLength, pages, hasFile: true,
  });
  try {
    await dbx.run(['docs', 'files'], 'readwrite', (s) => { doc.updatedAt = now; s.docs.put(doc); s.files.put({ id: doc.id, buf }); });
  } catch (e) {
    throw new Error(e?.name === 'QuotaExceededError' ? '저장 공간이 부족해요. 쓰지 않는 자료를 삭제한 뒤 다시 시도하세요' : `저장하지 못했어요: ${e?.message || e}`);
  }
  return { doc, dup: false, attached: !!stub };
}

export async function getBuffer(docId) {
  const f = await dbx.get('files', docId);
  return f?.buf || null;
}

export const getDoc = (id) => dbx.get('docs', id);
export async function updateDoc(id, patch) {
  const d = await getDoc(id);
  if (!d) return null;
  Object.assign(d, patch);
  await saveDoc(d);
  return d;
}
export const removeDoc = (id) => deleteDocCascade(id);

/** 내 PDF 를 (파일 없는) 자료에 연결. 해시가 다르면 다른 판본일 수 있음을 알린다. */
export async function attachFile(docId, buf) {
  const d = await getDoc(docId);
  if (!d) throw new Error('자료를 찾을 수 없어요');
  if (!head(buf).includes('%PDF')) throw new Error('PDF 파일이 아니에요');
  const hash = await sha256(buf);
  const other = (await dbx.all('docs')).find((x) => x.id !== docId && x.hasFile && x.hash === hash);
  if (other) throw new Error(`이 파일은 이미 “${other.title}” 자료로 저장돼 있어요`);
  const pdf = await loadPdf(buf); const pages = pdf.numPages; destroyPdf(pdf);
  const differs = d.hash && d.hash !== hash;
  Object.assign(d, { hash, size: buf.byteLength, pages, hasFile: true });
  await dbx.run(['docs', 'files'], 'readwrite', (s) => { d.updatedAt = Date.now(); s.docs.put(d); s.files.put({ id: d.id, buf }); });
  return { doc: d, differs };
}
