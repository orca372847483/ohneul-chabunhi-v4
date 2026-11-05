// PDF 본문 검색(자료 안에서). 글자 정보는 분석 때 저장한 텍스트를 쓰고, 없으면 이 자료만 즉석에서 추출해 저장한다.
import { dbx } from './db.js';
import { loadPdf, destroyPdf } from './pdfjs.js';
import { extractPages } from './extract.js';

export async function ensureText(docId, buf, onProgress) {
  const rec = await dbx.get('texts', docId);
  if (rec?.pages?.length) return rec.pages;
  const pdf = await loadPdf(buf);
  try {
    const pages = await extractPages(pdf, { onProgress });
    await dbx.put('texts', { docId, pages: pages.map((p) => ({ page: p.page, lines: p.lines, chars: p.chars, scanned: p.scanned, source: p.source })), questionPages: {}, mode: 'search-only', at: Date.now() });
    return pages;
  } finally { destroyPdf(pdf); }
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 공백 차이를 무시하고 검색한다(PDF 에서 줄바꿈·띄어쓰기가 달라져도 찾도록) */
export function searchPages(pages, query) {
  const q = query.trim();
  if (!q) return [];
  const re = new RegExp([...q.replace(/\s+/g, '')].map(esc).join('\\s*'), 'gi');
  const out = [];
  for (const p of pages) {
    const text = p.lines.join(' ');
    const ms = [...text.matchAll(re)];
    if (!ms.length) continue;
    const i = ms[0].index;
    out.push({ page: p.page, count: ms.length, before: text.slice(Math.max(0, i - 28), i), hit: ms[0][0], after: text.slice(i + ms[0][0].length, i + ms[0][0].length + 40) });
  }
  return out;
}
