// 출처 진단: 실패 원인을 계층별로 구분한다.
//   1 주소/허용도메인 → 2 DNS → 3 연결·TLS·HTTP 응답 → 4 리다이렉트 → 5 접근 제한(로그인/403) → 6 robots.txt → 7 페이지 구조(링크·제목 일치)
import dns from 'node:dns/promises';
import http from 'node:http';
import { checkUrl, rawFetch, decodeBody, classifyNetError, looksLikeLogin, parseRobots, robotsAllows, FetchError } from './guard.mjs';
import { parseAnchors, matchTitle, isPdfLike } from './parse.mjs';

/** 직접 DNS 가 안 될 때, 실행 환경에 프록시가 있으면 CONNECT 를 시도해 ‘진짜 DNS 문제’와 ‘환경 정책 차단’을 구분한다. */
function proxyConnectProbe(host, env) {
  const pr = env.HTTPS_PROXY || env.https_proxy; if (!pr) return Promise.resolve(null);
  return new Promise((resolve) => {
    let u; try { u = new URL(pr); } catch { return resolve(null); }
    const req = http.request({ host: u.hostname, port: u.port, method: 'CONNECT', path: `${host}:443`, timeout: 8000 });
    req.on('connect', (r, sock) => { sock.destroy(); resolve({ status: r.statusCode }); });
    req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

const step = (id, label, ok, detail, code = null) => ({ id, label, ok, detail, code });

export async function diagnoseUrl(url, { year, exam, month, env = process.env, timeoutMs = 12000 } = {}) {
  const steps = []; const out = { url, steps, verdict: null, anchors: 0, matches: [], pdfLinks: 0 };
  const done = (code, text) => { out.verdict = { code, text, ok: code === 'OK' }; return out; };

  const c = checkUrl(url, env);
  steps.push(step('url', '주소·허용 도메인', c.ok, c.ok ? new URL(url).host : c.reason, c.ok ? null : 'HOST_NOT_ALLOWED'));
  if (!c.ok) return done('HOST_NOT_ALLOWED', c.reason);
  const host = c.url.hostname;

  if (!/^[\d.]+$/.test(host) && !env.ALLOW_TEST_HOSTS) {
    try { const r = await dns.lookup(host, { all: true }); steps.push(step('dns', 'DNS 조회', true, r.map((x) => x.address).join(', '))); }
    catch (e) {
      const k = classifyNetError(e);
      const px = await proxyConnectProbe(host, env);
      if (px && px.status === 403) { const t = '이 실행 환경의 외부접속 정책(프록시)이 해당 도메인을 403 으로 거부했습니다. 사이트의 DNS·접근제한 문제가 아니라 실행 환경의 허용 도메인 설정 문제입니다'; steps.push(step('dns', 'DNS 조회', false, `직접 조회 실패(${k.code}) — 프록시 CONNECT 응답 403`, 'EGRESS_BLOCKED')); return done('EGRESS_BLOCKED', t); }
      if (px && px.status === 200) { steps.push(step('dns', 'DNS 조회', true, '직접 조회는 불가하지만 프록시 경유로 연결 가능')); }
      else { steps.push(step('dns', 'DNS 조회', false, k.text, k.code)); return done(k.code, k.text); }
    }
  }

  let res, finalUrl, chain = [];
  try { ({ res, url: finalUrl, chain } = await rawFetch(url, { env, timeoutMs, accept: 'text/html,application/xhtml+xml' })); }
  catch (e) {
    if (e instanceof FetchError) { steps.push(step('http', '연결·응답', false, e.message, e.code)); if (e.chain?.length) steps.push(step('redirect', '리다이렉트 경로', false, e.chain.map((x) => `${x.status}→${x.to}`).join('  '), e.code)); return done(e.code, e.message); }
    throw e;
  }
  steps.push(step('http', '연결·응답', res.status < 400, `HTTP ${res.status} · ${res.headers.get('content-type') || '형식 없음'}`));
  steps.push(step('redirect', '리다이렉트', true, chain.length ? chain.map((x) => `${x.status} → ${x.to}`).join('  /  ') : '없음'));
  const host2 = new URL(finalUrl).host; if (host2 !== new URL(url).host) steps.push(step('redirect-host', '도메인 변경', true, `${new URL(url).host} → ${host2} (주소 이전 가능성)`));

  if (res.status === 401 || res.status === 403) { steps.push(step('access', '접근 제한', false, `HTTP ${res.status}: 사이트가 자동 접근을 거부함(우회하지 않음)`, 'ACCESS_DENIED')); return done('ACCESS_DENIED', `사이트가 접근을 거부했습니다(HTTP ${res.status})`); }
  if (res.status === 404 || res.status === 410) return done('URL_CHANGED', `HTTP ${res.status}: 페이지가 없습니다 — 주소가 바뀐 것으로 보입니다`);
  if (res.status >= 500) return done('UPSTREAM_ERROR', `HTTP ${res.status}: 사이트 서버 오류(일시적일 수 있음)`);
  if (!res.ok) return done('UPSTREAM_STATUS', `HTTP ${res.status}`);

  const html = decodeBody(new Uint8Array(await res.arrayBuffer()).subarray(0, 2_000_000), res.headers.get('content-type') || '');
  if (looksLikeLogin(html, finalUrl)) { steps.push(step('access', '접근 제한', false, '로그인 요구 화면으로 보임(우회하지 않음)', 'LOGIN_REQUIRED')); return done('LOGIN_REQUIRED', '로그인이 필요한 페이지입니다'); }
  steps.push(step('access', '접근 제한', true, '로그인/차단 화면 아님'));

  try {
    const r = await rawFetch(new URL(finalUrl).origin + '/robots.txt', { env, timeoutMs: 6000, accept: 'text/plain' });
    if (r.res.ok) { const ok = robotsAllows(parseRobots((await r.res.text()).slice(0, 200000)), new URL(finalUrl).pathname + new URL(finalUrl).search); steps.push(step('robots', 'robots.txt', ok, ok ? '이 경로 허용' : '이 경로는 자동 수집 금지', ok ? null : 'ROBOTS_DISALLOW')); if (!ok) return done('ROBOTS_DISALLOW', 'robots.txt 가 이 경로의 자동 수집을 허용하지 않습니다'); }
    else steps.push(step('robots', 'robots.txt', true, `없음/무시(HTTP ${r.res.status})`));
  } catch { steps.push(step('robots', 'robots.txt', true, '확인 못함(무시)')); }

  const anchors = parseAnchors(html, finalUrl); out.anchors = anchors.length; out.pdfLinks = anchors.filter(isPdfLike).length;
  out.matches = anchors.filter((a) => matchTitle(a.text || a.title, { year, exam, month })).slice(0, 8).map((a) => ({ text: a.text, url: a.url }));
  const scripty = (html.match(/<script/gi) || []).length, hasAjaxHint = /(\$\.ajax|fetch\(|XMLHttpRequest|ng-app|__NEXT_DATA__|data-v-)/.test(html);
  steps.push(step('structure', '페이지 구조', anchors.length > 5, `${(html.length / 1024).toFixed(0)}KB · 링크 ${anchors.length}개 · PDF형 링크 ${out.pdfLinks}개 · 스크립트 ${scripty}개`));
  if (anchors.length <= 5) return done('STRUCTURE_SCRIPT', `링크가 거의 없습니다 — 목록을 자바스크립트로 불러오는 페이지${hasAjaxHint ? '(Ajax 흔적 있음)' : ''}이거나 구조가 바뀌었습니다. 브라우저 개발자도구 ▸ Network 에서 목록을 주는 실제 주소(XHR)를 찾아 SOURCES_JSON 에 넣어야 합니다`);
  steps.push(step('match', `${year || '?'}학년도 ${exam || '?'} 제목 일치`, out.matches.length > 0, `${out.matches.length}건`));
  if (!out.matches.length) return done('NO_MATCH', '목록은 읽었지만 해당 연도·시험 제목과 일치하는 링크가 없습니다(해당 회차가 아직 없거나, 제목 표기 규칙이 달라졌거나, 다음 쪽에 있을 수 있음)');
  return done('OK', `정상: 링크 ${anchors.length}개 중 ${out.matches.length}건 일치`);
}

/** 포털 첫 화면에서 ‘기출/모의평가/학력평가’ 링크를 찾아 실제 게시판 주소 후보를 제시한다(자동 적용하지 않음). */
export async function discoverLinks(homeUrl, { env = process.env } = {}) {
  const { res, url } = await rawFetch(homeUrl, { env, timeoutMs: 12000, accept: 'text/html' });
  if (!res.ok) throw new FetchError('UPSTREAM_STATUS', `HTTP ${res.status}`, { status: res.status });
  const html = decodeBody(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') || '');
  const seen = new Set();
  return parseAnchors(html, url).filter((a) => /(기출|모의평가|학력평가|수능.{0,6}(문제|자료)|문제.{0,4}정답)/.test(a.text || a.title || '')).filter((a) => !seen.has(a.url) && seen.add(a.url)).slice(0, 30).map((a) => ({ text: a.text, url: a.url }));
}
