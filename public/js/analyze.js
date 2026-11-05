// 자료 분석: PDF 텍스트 추출(+필요 시 OCR) → 지문 분할 → 규칙 기반 분류 → 저장
import { dbx, saveDoc } from './db.js';
import { loadPdf, destroyPdf } from './pdfjs.js';
import { extractPages } from './extract.js';
import { segmentPassages, passagePreview } from './segment.js';
import { classifyPassage } from './classify.js';
import { getBuffer } from './docs.js';
import { ocrCanvas, ocrStop } from './ocr.js';

const MAX_OCR_PAGES = 60;

function toRecord(docId, p, c, now) {
  const body = p.bodyLines.join('\n').slice(0, 6000);
  return {
    id: `${docId}|${p.idx}`, docId, idx: p.idx, qFrom: p.qFrom, qTo: p.qTo, pageFrom: p.pageFrom, pageTo: p.pageTo,
    heading: p.heading || '', section: p.section || null, fallback: !!p.fallback,
    preview: passagePreview(p, 90), body, qtext: p.qLines.join('\n').slice(0, 3000),
    tags: c.tags, primary: c.primary, confidence: c.confidence, status: c.status, evidence: c.evidence, method: c.method,
    manual: false, updatedAt: now,
  };
}

/** 저장된 본문으로 분류만 다시 계산(수동 지정 해제 용) */
export function reclassify(rec) {
  const c = classifyPassage({ bodyLines: rec.body.split('\n'), qLines: (rec.qtext || '').split('\n'), section: rec.section, heading: rec.heading });
  return { ...rec, tags: c.tags, primary: c.primary, confidence: c.confidence, status: c.status, evidence: c.evidence, method: c.method, manual: false, updatedAt: Date.now() };
}

/**
 * @param {string} docId
 * @param {{onProgress?:(msg:string,n?:number,t?:number)=>void, confirmOcr?:(info:{scanned:number[],total:number})=>Promise<boolean>}} o
 */
export async function analyzeDoc(docId, { onProgress, confirmOcr } = {}) {
  const buf = await getBuffer(docId);
  if (!buf) throw new Error('이 기기에는 PDF 파일이 없어요. PDF를 먼저 연결하세요');
  const doc = await dbx.get('docs', docId);
  const pdf = await loadPdf(buf);
  const note = [];
  let ocrUsed = false;
  try {
    const pages = await extractPages(pdf, { onProgress: (n, t) => onProgress?.('텍스트 추출', n, t) });
    const scanned = pages.filter((p) => p.scanned).map((p) => p.page);
    if (scanned.length && scanned.length >= Math.ceil(pages.length * 0.5)) {
      const go = confirmOcr ? await confirmOcr({ scanned, total: pages.length }) : false;
      if (go) {
        try {
          const targets = scanned.slice(0, MAX_OCR_PAGES);
          let i = 0;
          for (const n of targets) {
            onProgress?.('OCR(글자 인식)', ++i, targets.length);
            const page = await pdf.getPage(n);
            const vp = page.getViewport({ scale: 2 });
            const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
            await page.render({ canvasContext: cv.getContext('2d'), canvas: cv, viewport: vp }).promise;
            const lines = await ocrCanvas(cv);
            const target = pages.find((p) => p.page === n);
            Object.assign(target, { lines, chars: lines.join('').replace(/\s/g, '').length, source: 'ocr', scanned: false });
            cv.width = cv.height = 0; page.cleanup();
          }
          ocrUsed = true;
          if (scanned.length > MAX_OCR_PAGES) note.push(`OCR 은 ${MAX_OCR_PAGES}쪽까지만 처리했어요`);
          note.push('OCR 로 읽은 글자는 오탈자가 있을 수 있어 분류 정확도가 낮을 수 있어요');
        } catch (e) { note.push(`OCR 실패: ${e.message}`); } finally { await ocrStop(); }
      } else note.push('스캔된 PDF로 보여요. OCR 없이는 지문을 분류할 수 없어서 수동 분류가 필요해요');
    }

    onProgress?.('지문 분할·분류');
    const seg = segmentPassages(pages);
    const now = Date.now();
    const old = await dbx.byIndex('passages', 'docId', docId);
    const keepManual = old.filter((o) => o.manual);
    const recs = seg.passages.map((p) => toRecord(docId, p, classifyPassage(p), now));
    // 수동 지정은 같은 문항 범위(없으면 같은 쪽)의 새 지문에 그대로 옮긴다. 대응되는 지문이 없으면 별도 보존.
    const used = new Set();
    for (const m of keepManual) {
      const t = recs.find((r) => !used.has(r.id) && ((m.qFrom && r.qFrom === m.qFrom && r.qTo === m.qTo) || (!m.qFrom && r.pageFrom === m.pageFrom)));
      if (t) { Object.assign(t, { tags: m.tags, primary: m.primary, confidence: 1, status: 'manual', evidence: m.evidence, manual: true, updatedAt: now }); used.add(t.id); }
      else { m.idx = 1000 + recs.length; m.id = `${docId}|${m.idx}`; recs.push(m); }
    }
    recs.sort((a, b) => a.pageFrom - b.pageFrom || (a.qFrom || 0) - (b.qFrom || 0));
    await dbx.run(['passages', 'texts'], 'readwrite', (s) => {
      for (const o of old) s.passages.delete(o.id);
      recs.forEach((r) => s.passages.put(r));
      s.texts.put({ docId, pages: pages.map((p) => ({ page: p.page, lines: p.lines, chars: p.chars, scanned: p.scanned, source: p.source })), questionPages: seg.questionPages, mode: seg.mode, at: now });
    });
    if (seg.mode === 'page-fallback') note.push('“[1～3]” 같은 지문 표지를 찾지 못해 글자가 많은 쪽을 지문으로 간주했어요(정확도 낮음)');
    if (seg.mode === 'none') note.push('텍스트에서 지문을 찾지 못했어요. 지문을 직접 추가·분류할 수 있어요');
    const auto = recs.filter((r) => r.status === 'auto').length;
    doc.analysis = { at: now, mode: seg.mode, passages: recs.length, auto, needsManual: recs.filter((r) => r.status === 'needs-manual').length, scannedPages: scanned, ocrUsed, note };
    await saveDoc(doc);
    return doc.analysis;
  } finally { destroyPdf(pdf); }
}
