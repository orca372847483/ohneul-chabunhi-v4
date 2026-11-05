// GET /api/fetch-pdf?url=<공식 PDF 주소>
// 공식 도메인의 PDF만 스트리밍으로 전달한다(%PDF 매직 확인, 용량 제한, robots.txt 준수).
import { makeContext, politeFetch, FetchError, errorBody, jsonResponse } from './lib/guard.mjs';

export const config = { path: '/api/fetch-pdf' };
const MAX_BYTES = 20 * 1024 * 1024; // Netlify 스트리밍 응답 한도(20MB) 이내

export default async (req) => {
  const target = new URL(req.url).searchParams.get('url');
  if (!target) return jsonResponse({ ok: false, code: 'BAD_REQUEST', message: 'url 파라미터가 필요합니다' }, 400);
  try {
    const ctx = makeContext(process.env);
    const { res, url } = await politeFetch(target, ctx, { accept: 'application/pdf,*/*;q=0.8', timeoutMs: 15000 });
    if (res.status === 401 || res.status === 403) throw new FetchError('ACCESS_DENIED', `사이트가 접근을 허용하지 않습니다(HTTP ${res.status}). 접근 제한은 우회하지 않습니다`, { status: res.status });
    if (!res.ok) throw new FetchError('UPSTREAM_STATUS', `사이트 응답 오류(HTTP ${res.status})`, { status: res.status });
    const len = parseInt(res.headers.get('content-length') || '0', 10);
    if (len > MAX_BYTES) throw new FetchError('TOO_LARGE', `파일이 ${Math.round(len / 1048576)}MB로 자동 전달 한도(20MB)를 넘습니다`);
    const reader = res.body.getReader();
    const first = await reader.read();
    const head = first.value ? Buffer.from(first.value.subarray(0, 8)).toString('latin1') : '';
    if (!head.includes('%PDF')) { reader.cancel().catch(() => {}); throw new FetchError('NOT_PDF', 'PDF 파일이 아닌 응답입니다(로그인 페이지이거나 다운로드 방식이 다를 수 있음)'); }
    let sent = first.value.length;
    const stream = new ReadableStream({
      start(c) { c.enqueue(first.value); },
      async pull(c) {
        const { done, value } = await reader.read();
        if (done) return c.close();
        sent += value.length;
        if (sent > MAX_BYTES) { reader.cancel().catch(() => {}); return c.error(new Error('size limit')); }
        c.enqueue(value);
      },
      cancel() { reader.cancel().catch(() => {}); },
    });
    const name = decodeURIComponent((new URL(url).pathname.split('/').pop() || 'exam.pdf'));
    return new Response(stream, { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store', 'x-source-url': url, 'x-file-name': encodeURIComponent(name) } });
  } catch (e) {
    return jsonResponse(errorBody(e), e.code === 'HOST_NOT_ALLOWED' ? 400 : 502);
  }
};
