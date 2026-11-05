// 게시판 HTML 파싱 (외부 의존성 없음) 및 제목 매칭

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
export const decodeEntities = (s) => s.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENT[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
export const stripTags = (s) => decodeEntities(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** <a> 태그를 모두 추출. onclick 만 있는 JS 링크는 jsOnly 로 표시한다. */
export function parseAnchors(html, baseUrl) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const get = (n) => { const x = attrs.match(new RegExp(`${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return x ? decodeEntities(x[2] ?? x[3] ?? x[4] ?? '') : ''; };
    const href = get('href');
    const title = get('title');
    const text = stripTags(m[2]) || title;
    // 앵커 앞쪽 120자(같은 행의 제목 등 맥락)
    const before = stripTags(html.slice(Math.max(0, m.index - 300), m.index)).slice(-120);
    let url = null;
    if (href && !/^(javascript:|#|mailto:|tel:)/i.test(href)) { try { url = new URL(href, baseUrl).href; } catch { /* ignore */ } }
    out.push({ url, text, title, before, jsOnly: !url && (/javascript:/i.test(href) || /onclick/i.test(attrs)) });
  }
  return out;
}

const EXAM_RULES = {
  csat: (t) => /(대학수학능력시험|수능)/.test(t) && !/(모의평가|모평|학력평가|예비시행|예비 시행)/.test(t),
  jun: (t) => /6\s*월/.test(t) && /(모의평가|모평)/.test(t),
  sep: (t) => /9\s*월/.test(t) && /(모의평가|모평)/.test(t),
  office: (t) => /(학력평가)/.test(t),
};

export function matchTitle(title, { year, exam, month }) {
  const t = String(title || '').replace(/\s+/g, ' ');
  if (!new RegExp(`(^|\\D)${year}\\s*(학년도|년)`).test(t)) return false;
  const rule = EXAM_RULES[exam];
  if (!rule || !rule(t)) return false;
  if (exam === 'office' && month && !new RegExp(`(^|\\D)${month}\\s*월`).test(t)) return false;
  return true;
}

export function isPdfLike(a) {
  return !!a.url && (/\.pdf(\?|#|$)/i.test(a.url) || /(file\s*down|filedown|download|attach|fileDownload|\.do\?.*file)/i.test(a.url) || /\.pdf\b/i.test(a.text));
}

export function attachmentPart(label) {
  if (/정답/.test(label) && !/문제/.test(label)) return '정답';
  if (/해설/.test(label)) return '해설';
  if (/(문제|문항|시험지|문제지)/.test(label)) return '문제';
  return '기타';
}

export function monthOf(title) {
  const m = String(title).match(/(3|4|5|6|7|9|10|11)\s*월/);
  return m ? +m[1] : null;
}
