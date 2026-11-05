// 외부 접근 안전장치: 공식 도메인 허용 목록, robots.txt 준수, 리다이렉트 재검증, 시간·용량 제한
// 로그인/접근 제한 우회 기능은 의도적으로 없다. 응답이 401/403이면 그대로 실패로 보고한다.

export const UA = 'OneulChabunhi-ExamLibrary/4.0 (personal study tool; respects robots.txt)';
const BASE_HOSTS = ['kice.re.kr', 'suneung.re.kr', 'ebsi.co.kr', 'ebs.co.kr', 'go.kr'];

export class FetchError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

const list = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

/** fetch 실패(undici)의 원인을 계층별로 구분한다: DNS → 연결 → TLS → 시간 초과 → 실행 환경의 외부접속 차단 */
export function classifyNetError(e) {
  const c = e?.cause || e;
  const code = c?.code || e?.code || '';
  const msg = String(c?.message || e?.message || '');
  if (e?.name === 'AbortError') return { code: 'TIMEOUT', layer: '응답 시간', text: '연결은 시작됐지만 제한 시간 안에 응답이 없습니다' };
  if (/ENOTFOUND|EAI_AGAIN|EAI_NODATA/.test(code)) return { code: 'DNS', layer: 'DNS', text: `도메인 이름을 IP 로 바꾸지 못했습니다(${code}). 주소 오타이거나, 실행 환경의 DNS/외부접속 정책 문제일 수 있습니다` };
  if (/CONNECT tunnel|Proxy response|proxy/i.test(msg) || /UND_ERR_PROXY/.test(code)) return { code: 'EGRESS_BLOCKED', layer: '실행 환경 외부접속 정책', text: '이 실행 환경의 프록시/방화벽이 해당 도메인 접속을 거부했습니다(사이트 자체의 문제가 아님)' };
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE/.test(code)) return { code: 'CONNECT', layer: 'TCP 연결', text: `서버에 연결하지 못했습니다(${code})` };
  if (/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT/.test(code)) return { code: 'TIMEOUT', layer: 'TCP 연결', text: `연결 시간 초과(${code})` };
  if (/CERT|SSL|TLS|self.signed|UNABLE_TO_VERIFY/i.test(code + msg)) return { code: 'TLS', layer: 'TLS 인증서', text: `보안 연결(TLS) 확인에 실패했습니다(${code || msg.slice(0, 60)})` };
  return { code: 'NETWORK', layer: '네트워크', text: `네트워크 연결 실패: ${code || msg || e}` };
}
export const NET_CODES = ['NETWORK', 'DNS', 'CONNECT', 'TLS', 'TIMEOUT', 'EGRESS_BLOCKED'];

/** 로그인 페이지/로그인 리다이렉트인지(우회하지 않고 사유만 보고) */
export function looksLikeLogin(html, finalUrl = '') {
  const urlHit = /(login|logon|signin|member\/log|sso|auth)/i.test(new URL(finalUrl, 'http://x').pathname);
  const form = /<input[^>]+type=["']?password/i.test(html || '');
  const text = /(로그인(이)? 후|로그인이 필요|회원만|로그인 해주세요)/.test(html || '');
  return (urlHit && form) || (form && text) || (text && (html || '').length < 6000);
}

export function allowedHosts(env = process.env) { return [...BASE_HOSTS, ...list(env.EXTRA_ALLOWED_HOSTS)]; }

export function checkUrl(raw, env = process.env) {
  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: '올바른 URL이 아닙니다' }; }
  const testHosts = list(env.ALLOW_TEST_HOSTS); // 테스트 전용(로컬 fixture 서버). 배포 환경에서는 설정하지 않는다.
  if (testHosts.includes(u.host.toLowerCase())) return { ok: true, url: u };
  if (u.protocol !== 'https:') return { ok: false, reason: 'https 주소만 허용됩니다' };
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost') return { ok: false, reason: 'IP 주소/로컬 주소는 허용되지 않습니다' };
  if (u.port && u.port !== '443') return { ok: false, reason: '기본 포트만 허용됩니다' };
  const ok = allowedHosts(env).some((h) => host === h || host.endsWith('.' + h));
  return ok ? { ok: true, url: u } : { ok: false, reason: `공식 출처 허용 목록에 없는 도메인입니다 (${host})` };
}

export async function rawFetch(url, { method = 'GET', timeoutMs = 9000, headers = {}, accept = '*/*', env = process.env, maxRedirects = 4 } = {}) {
  let cur = url;
  const chain = [];
  for (let i = 0; i <= maxRedirects; i++) {
    const c = checkUrl(cur, env);
    if (!c.ok) throw new FetchError('HOST_NOT_ALLOWED', c.reason, { url: cur });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(cur, { method, redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': UA, accept, 'accept-language': 'ko-KR,ko;q=0.9', ...headers } });
    } catch (e) {
      clearTimeout(t);
      const k = classifyNetError(e);
      throw new FetchError(k.code, k.text, { url: cur, layer: k.layer, chain });
    }
    clearTimeout(t);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new FetchError('UPSTREAM_STATUS', '리다이렉트 위치가 없습니다', { status: res.status, url: cur });
      chain.push({ from: cur, status: res.status, to: new URL(loc, cur).href });
      cur = new URL(loc, cur).href;
      continue;
    }
    return { res, url: cur, chain };
  }
  throw new FetchError('TOO_MANY_REDIRECTS', `리다이렉트가 너무 많습니다(${chain.length}회 반복: ${chain.slice(-2).map((c) => c.to).join(' ⇄ ')})`, { url, layer: '리다이렉트', chain });
}

// ---- robots.txt ----
export function parseRobots(text, agentToken = 'oneulchabunhi') {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasAgent = true;
    } else if ((k === 'allow' || k === 'disallow') && cur) {
      cur.rules.push({ allow: k === 'allow', path: v }); lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && agentToken.includes(a))) || groups.find((g) => g.agents.includes('*'));
  return mine ? mine.rules : [];
}

export function robotsAllows(rules, pathWithQuery) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue; // 빈 Disallow = 모두 허용
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(pathWithQuery) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

export function makeContext(env = process.env) {
  return { env, robots: new Map(), last: 0 };
}

async function robotsFor(origin, ctx) {
  if (ctx.robots.has(origin)) return ctx.robots.get(origin);
  let rules = [], note = null;
  try {
    const { res } = await rawFetch(origin + '/robots.txt', { env: ctx.env, timeoutMs: 6000, accept: 'text/plain' });
    if (res.status >= 500) { rules = [{ allow: false, path: '/' }]; note = `robots.txt 서버 오류(${res.status})로 보수적으로 수집을 중단했습니다`; }
    else if (res.ok) rules = parseRobots((await res.text()).slice(0, 200000));
    else rules = [];
  } catch (e) {
    if (e instanceof FetchError && NET_CODES.includes(e.code)) throw e;
    rules = [];
  }
  const v = { rules, note };
  ctx.robots.set(origin, v);
  return v;
}

/** robots.txt 를 확인하고 예의 있는 간격으로 가져온다. */
export async function politeFetch(url, ctx, opts = {}) {
  const c = checkUrl(url, ctx.env);
  if (!c.ok) throw new FetchError('HOST_NOT_ALLOWED', c.reason, { url });
  const { rules, note } = await robotsFor(c.url.origin, ctx);
  if (!robotsAllows(rules, c.url.pathname + c.url.search)) {
    throw new FetchError('ROBOTS_DISALLOW', note || `해당 사이트의 robots.txt 가 이 경로의 자동 수집을 허용하지 않습니다`, { url });
  }
  const wait = 250 - (Date.now() - ctx.last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  ctx.last = Date.now();
  return rawFetch(url, { env: ctx.env, ...opts });
}

export function decodeBody(buf, contentType = '') {
  let cs = (contentType.match(/charset=([^;\s]+)/i) || [])[1];
  if (!cs) {
    const head = Buffer.from(buf.subarray(0, 2048)).toString('latin1');
    cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  cs = (cs || 'utf-8').toLowerCase().replace('ks_c_5601-1987', 'euc-kr');
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

export async function fetchText(url, ctx, { maxBytes = 2_000_000 } = {}) {
  const { res, url: finalUrl } = await politeFetch(url, ctx, { accept: 'text/html,application/xhtml+xml' });
  if (res.status === 401 || res.status === 403) throw new FetchError('ACCESS_DENIED', `사이트가 접근을 허용하지 않습니다(HTTP ${res.status}). 로그인/접근 제한은 우회하지 않습니다`, { status: res.status, url });
  if (!res.ok) throw new FetchError('UPSTREAM_STATUS', `사이트 응답 오류(HTTP ${res.status})`, { status: res.status, url });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new FetchError('TOO_LARGE', '페이지가 너무 큽니다', { url });
  const html = decodeBody(buf, res.headers.get('content-type') || '');
  if (looksLikeLogin(html, finalUrl)) throw new FetchError('LOGIN_REQUIRED', '로그인이 필요한 페이지로 보입니다. 로그인은 우회하지 않습니다', { url: finalUrl, layer: '접근 제한(로그인)' });
  return { html, url: finalUrl, bytes: buf.length, status: res.status };
}

export function jsonResponse(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
}

export function errorBody(e) {
  const hints = {
    HOST_NOT_ALLOWED: '공식 출처(평가원·EBS·시도교육청) 주소만 허용됩니다.',
    ROBOTS_DISALLOW: '자동 수집이 제한된 경로입니다. 공식 페이지에서 직접 내려받아 “내 PDF 열기”로 추가하세요.',
    ACCESS_DENIED: '사이트가 자동 접근을 거부했습니다. 공식 페이지에서 직접 내려받아 추가하세요.',
    DNS: '도메인을 찾지 못했습니다. 주소 오타인지, 서버(또는 이 실행 환경)의 DNS 가 막혀 있는지 확인하세요.',
    EGRESS_BLOCKED: '이 실행 환경의 외부접속 정책이 막고 있습니다. 사이트 문제가 아니므로 인터넷이 열린 PC/배포 환경에서 다시 시도하세요.',
    CONNECT: '서버가 연결을 받지 않습니다(점검·차단·주소 변경 가능성).',
    TLS: '보안 인증서 확인에 실패했습니다. 주소가 https 로 올바른지 확인하세요.',
    LOGIN_REQUIRED: '로그인해야 볼 수 있는 자료입니다. 공식 사이트에 로그인해 직접 내려받은 뒤 “내 PDF 추가”로 넣어 주세요.',
    TOO_MANY_REDIRECTS: '주소가 계속 다른 주소로 바뀝니다(로그인/약관 동의 페이지로 순환하는 경우가 많음).',
    NETWORK: '서버에서 해당 사이트로 연결하지 못했습니다. 잠시 후 다시 시도하거나 공식 페이지를 직접 여세요.',
    TIMEOUT: '사이트 응답이 느립니다. 잠시 후 다시 시도하세요.',
    UPSTREAM_STATUS: '사이트가 오류를 반환했습니다. 주소가 바뀌었을 수 있습니다.',
    TOO_LARGE: '파일이 자동 전달 한도를 넘습니다. 공식 페이지에서 직접 내려받아 추가하세요.',
    NOT_PDF: 'PDF가 아닌 응답입니다. 공식 페이지에서 직접 확인하세요.',
  };
  return { ok: false, code: e.code || 'ERROR', message: e.message || String(e), hint: hints[e.code] || '', status: e.status, layer: e.layer || null };
}
