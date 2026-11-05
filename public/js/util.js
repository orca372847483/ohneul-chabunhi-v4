export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' || k.includes('-')) e.setAttribute(k, v);
    else if (k in e) { try { e[k] = v; } catch { e.setAttribute(k, v); } }
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
export const pad = (n) => String(n).padStart(2, '0');
export function fmtTime(sec) { sec = Math.max(0, Math.floor(sec)); return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`; }
export const ymd = (ts = Date.now()) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n).getTime()); };
export const dayLabel = (s) => { const [y, m, d] = s.split('-').map(Number); return `${m}월 ${d}일 (${'일월화수목금토'[new Date(y, m - 1, d).getDay()]})`; };
export function fmtDur(sec) { sec = Math.floor(sec); if (sec < 60) return `${sec}초`; const m = Math.floor(sec / 60); return m < 60 ? `${m}분 ${sec % 60}초` : `${Math.floor(m / 60)}시간 ${m % 60}분`; }
export function fmtDate(ts) { const d = new Date(ts); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

export function debounce(fn, ms) { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); fn(...a); }; return f; }

export async function sha256(buf) {
  if (crypto?.subtle) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  // 비보안 컨텍스트(http, LAN 주소) 대체: FNV-1a 64bit 유사 해시 (중복 판별용)
  const u = new Uint8Array(buf); let a = 0x811c9dc5, b = 0xcbf29ce4;
  for (let i = 0; i < u.length; i++) { a = Math.imul(a ^ u[i], 16777619) >>> 0; b = Math.imul(b ^ u[(i * 7) % u.length], 2246822519) >>> 0; }
  return 'f' + a.toString(16) + b.toString(16) + u.length.toString(16);
}

export function toast(msg, kind = 'info', ms = 4200) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status', text: msg });
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
export function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 비공개 모드 등 */ } }

export const EXAMS = { csat: '수능', jun: '6월 모의평가', sep: '9월 모의평가', office: '교육청 학력평가' };
export const EXAM_ORDER = { csat: 0, jun: 1, sep: 2, office: 3 };
export function examLabel(d) { return d.exam === 'office' && d.month ? `교육청 ${d.month}월` : EXAMS[d.exam] || d.exam || '기타'; }
export function docTitle(d) { return `${d.year ? d.year + '학년도 ' : ''}${examLabel(d)} 국어`; }
export function latestYear(now = new Date()) { return now.getMonth() >= 2 ? now.getFullYear() + 1 : now.getFullYear(); }

export function download(name, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// replaceChildren 에 배열·null·false 를 그대로 넘겨도 되도록 평탄화(렌더링 코드를 간결하게 쓰기 위함)
const _rc = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...kids) { return _rc.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false)); };
