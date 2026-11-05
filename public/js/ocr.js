// 스캔 PDF 용 OCR (Tesseract.js, 필요할 때만 CDN 에서 내려받음).
// ⚠️ 개발 환경에서는 외부 CDN 접속이 막혀 실제 OCR 정확도는 검증하지 못했다. 구조(호출·진행률·실패 안내)만 구현.
const SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading = null, worker = null;

function loadScript() {
  if (globalThis.Tesseract) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SRC; s.crossOrigin = 'anonymous';
    s.onload = res;
    s.onerror = () => { loading = null; rej(new Error('OCR 엔진(Tesseract.js)을 내려받지 못했어요. 인터넷 연결 또는 접속 제한을 확인하세요')); };
    document.head.append(s);
  });
  return loading;
}

export async function ocrAvailable() {
  try { await loadScript(); return true; } catch { return false; }
}

export async function ocrCanvas(canvas, { lang = 'kor+eng', onProgress } = {}) {
  await loadScript();
  if (!worker) {
    try {
      worker = await globalThis.Tesseract.createWorker(lang, 1, { logger: (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress); } });
    } catch (e) { throw new Error(`OCR 언어 데이터를 불러오지 못했어요 (${e?.message || e})`); }
  }
  const { data } = await worker.recognize(canvas);
  return (data.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

export async function ocrStop() {
  try { await worker?.terminate(); } catch { /* ignore */ }
  worker = null;
}
