// PDF 텍스트 추출 (pdf.js 인스턴스 주입 방식 → 브라우저/Node 공용)
// 2단 편집 시험지를 고려해 좌/우 단을 나눠서 읽는다. 글자가 거의 없는 페이지는 '스캔'으로 표시한다.

export function itemsToLines(items, pageWidth) {
  const its = items
    .filter((i) => typeof i.str === 'string' && i.str.trim() !== '')
    .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: i.height || Math.abs(i.transform[3]) || 10 }));
  if (!its.length) return [];
  const mid = pageWidth / 2;
  const left = its.filter((i) => i.x < mid - 5);
  const right = its.filter((i) => i.x >= mid - 5);
  const crossing = its.filter((i) => i.x < mid - 5 && i.x + i.w > mid + 5);
  const twoCol = left.length / its.length > 0.25 && right.length / its.length > 0.25 && crossing.length / its.length < 0.2;
  if (!twoCol) return groupLines(its);
  const l = its.filter((i) => i.x < mid - 5 || (i.x + i.w > mid + 5 && i.x < mid));
  const r = its.filter((i) => !l.includes(i));
  return [...groupLines(l), ...groupLines(r)];
}

function groupLines(its) {
  const sorted = [...its].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(2, 0.5 * Math.min(last.h, it.h))) last.items.push(it);
    else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  return lines
    .map((ln) => {
      ln.items.sort((a, b) => a.x - b.x);
      let out = '';
      let prev = null;
      for (const it of ln.items) {
        if (prev && it.x - (prev.x + prev.w) > 0.2 * ln.h && !out.endsWith(' ') && !it.s.startsWith(' ')) out += ' ';
        out += it.s;
        prev = it;
      }
      return out.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

export async function extractPages(pdf, { onProgress, minChars = 30, only = null } = {}) {
  const pages = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    if (only && !only.includes(n)) continue;

    let page;

    try {
      page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const lines = itemsToLines(tc.items, vp.width);
      const chars = lines.join('').replace(/\s/g, '').length;

      pages.push({
        page: n,
        lines,
        chars,
        scanned: chars < minChars,
        source: 'text'
      });

      onProgress?.(n, pdf.numPages);
    } catch (e) {
      console.error(`PDF ${n}쪽 추출 오류`, e);
throw new Error(`${n}쪽 텍스트 추출 실패: ${String(e)}`);
    } finally {
      page?.cleanup();
    }
  }

  return pages;
}
