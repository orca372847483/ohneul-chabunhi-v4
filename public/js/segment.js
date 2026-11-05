// 페이지별 텍스트 줄 → 지문 단위 분할 (브라우저/Node 공용)
// 수능·모의평가·학평 국어 시험지의 "[1～3] 다음 글을 읽고 물음에 답하시오." 형식을 기준으로 한다.

const MARK = /^\s*[\[［]\s*(\d{1,2})\s*[～~∼〜⁓˜\-–—―]\s*(\d{1,2})\s*[\]］]\s*(.*)$/;
const QSTART = /^\s*(\d{1,2})\s*[.．]\s*\S/;
const SECTION = /^\s*[※◦●○■□▶·\-]?\s*(화법과\s*작문|언어와\s*매체|독서|문학)\s*(?:[(（].*[)）])?\s*$/;
const NOISE = [
  /^\s*\d{1,2}\s*$/,
  /^\s*\d{1,2}\s*국어\s*영역\s*$/, /^\s*국어\s*영역\s*\d{1,2}\s*$/,
  /^\s*(홀수|짝수)형\s*$/, /^\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/,
  /저작권/, /이\s*문제지에\s*관한/,
];
const isNoise = (t) => NOISE.some((r) => r.test(t));

export function segmentPassages(pages) {
  const passages = [];
  const questionPages = {};
  let cur = null;
  let section = null;

  for (const pg of pages) {
    for (const raw of pg.lines) {
      const t = raw.trim();
      if (!t) continue;
      if (t.length < 30) {
        const sm = t.match(SECTION);
        if (sm) { section = sm[1].replace(/\s+/g, ''); if (section === '화법과작문') section = '화법과 작문'; if (section === '언어와매체') section = '언어와 매체'; continue; }
      }
      const m = t.match(MARK);
      if (m) {
        const a = +m[1], b = +m[2];
        if (b >= a && b <= 60) {
          cur = { idx: passages.length + 1, qFrom: a, qTo: b, pageFrom: pg.page, pageTo: pg.page, heading: m[3].trim(), section: section === '독서' || section === '문학' ? null : section, bodyLines: [], qLines: [], inQ: false };
          passages.push(cur);
          continue;
        }
      }
      if (!cur || isNoise(t)) continue;
      cur.pageTo = pg.page;
      const qm = t.match(QSTART);
      if (qm) {
        const n = +qm[1];
        if (n >= cur.qFrom && n <= cur.qTo) {
          if (!cur.inQ && n === cur.qFrom) cur.inQ = true;
          if (cur.inQ && questionPages[n] == null) questionPages[n] = pg.page;
        }
      }
      (cur.inQ ? cur.qLines : cur.bodyLines).push(t);
    }
  }

  if (passages.length) {
    for (const p of passages) delete p.inQ;
    return { passages, questionPages, mode: 'markers' };
  }

  // 마커를 찾지 못한 경우: 글자가 충분한 페이지를 지문 후보로 사용(정확도 낮음)
  const fb = [];
  for (const pg of pages) {
    const text = pg.lines.join('');
    if (text.replace(/\s/g, '').length < 150) continue;
    const lines = pg.lines.map((l) => l.trim()).filter((l) => l && !isNoise(l));
    fb.push({ idx: fb.length + 1, qFrom: null, qTo: null, pageFrom: pg.page, pageTo: pg.page, heading: '', section: null, bodyLines: lines, qLines: [], fallback: true });
  }
  return { passages: fb, questionPages, mode: fb.length ? 'page-fallback' : 'none' };
}

export function passagePreview(p, n = 60) {
  const t = (p.heading ? p.heading + ' ' : '') + p.bodyLines.join(' ');
  return t.replace(/\s+/g, ' ').trim().slice(0, n);
}
