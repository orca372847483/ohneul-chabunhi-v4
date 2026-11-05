// GET /api/health — 서버 기능 사용 가능 여부(환경변수 설정 상태). 비밀값은 노출하지 않는다.
import { jsonResponse, allowedHosts } from './lib/guard.mjs';
import { getSources } from './lib/sources.mjs';

export const config = { path: '/api/health' };

export default async () => {
  const sources = getSources(process.env);
  return jsonResponse({
    ok: true,
    version: '4.0.0',
    node: process.version,
    features: {
      collect: true,
      fetchPdf: true,
      sync: process.env.SYNC_TEST_MEMORY === '1' ? 'test-memory' : 'netlify-blobs',
      syncProtected: !!process.env.SYNC_ACCESS_CODE,
    },
    sources: sources.map((s) => ({ id: s.id, name: s.name, exams: s.exams, verified: !!s.verified })),
    allowedHosts: allowedHosts(process.env).filter((h) => !process.env.ALLOW_TEST_HOSTS || true),
    custom: { sourcesJson: !!process.env.SOURCES_JSON, extraHosts: !!process.env.EXTRA_ALLOWED_HOSTS },
  });
};
