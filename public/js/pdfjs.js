// pdf.js 로더 (로컬 vendor 사본 사용: 외부 CDN 불필요). 레거시 빌드라 구형 Safari 도 지원한다.
let lib = null;
const BASE = '/vendor/pdfjs/';

export async function pdfjs() {
  if (lib) return lib;
  lib = await import(/* @vite-ignore */ BASE + 'pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs';
  return lib;
}

/** ArrayBuffer → PDFDocumentProxy. pdf.js 는 전달한 버퍼를 분리(detach)하므로 반드시 복사본을 넘긴다. */
export async function loadPdf(buf) {
  const l = await pdfjs();
  const task = l.getDocument({
    data: new Uint8Array(buf.slice(0)),
    cMapUrl: BASE + 'cmaps/', cMapPacked: true,
    standardFontDataUrl: BASE + 'standard_fonts/',
    wasmUrl: BASE + 'wasm/', iccUrl: BASE + 'iccs/',
    isEvalSupported: false,
  });
  try { return await task.promise; }
  catch (e) { throw new Error(explainPdfError(e)); }
}

export function explainPdfError(e) {
  const n = e?.name || '';
  if (n === 'PasswordException') return '암호가 걸린 PDF라 열 수 없어요. 암호를 해제한 파일을 사용해 주세요';
  if (n === 'InvalidPDFException') return 'PDF 파일이 손상되었거나 PDF 형식이 아니에요';
  if (n === 'MissingPDFException') return 'PDF 파일을 찾을 수 없어요';
  return `PDF를 열지 못했어요 (${e?.message || n || '알 수 없는 오류'})`;
}

/** 버전에 따라 PDFDocumentProxy.destroy 가 없을 수 있어 loadingTask 로 정리한다 */
export function destroyPdf(pdf) {
  try { if (pdf?.loadingTask?.destroy) return pdf.loadingTask.destroy(); if (pdf?.destroy) return pdf.destroy(); } catch { /* ignore */ }
}
