// /api/sync — 클라우드 동기화(필기·메모·분류·풀이 기록·자료 정보). PDF 원본은 저작권/용량 문제로 동기화하지 않는다.
//
//   GET  /api/sync?op=manifest            → { manifest: { id: {u, d?, doc?} } }
//   POST /api/sync?op=push  {records:[{id,u,d?,doc?,data}]} → 최신(u) 우선(Last-Write-Wins)
//   POST /api/sync?op=pull  {ids:[...]}   → { records:[...] }
//
// 인증: 헤더 x-sync-key (기기에서 생성한 무작위 비밀키, 서버에는 SHA-256 해시로만 저장되는 네임스페이스로 사용)
//       환경변수 SYNC_ACCESS_CODE 가 설정되면 x-sync-code 도 일치해야 한다(낯선 사용자의 저장공간 사용 방지).
// 저장소: Netlify Blobs. 테스트용으로 SYNC_TEST_MEMORY=1 이면 프로세스 메모리 저장소를 사용한다(비영속).
import { jsonResponse } from './lib/guard.mjs';

export const config = { path: '/api/sync' };
const MAX_BODY = 4_000_000;
const memory = new Map();

function memoryStore() {
  return {
    async get(k) { return memory.has(k) ? JSON.parse(memory.get(k)) : null; },
    async setJSON(k, v) { memory.set(k, JSON.stringify(v)); },
  };
}

export async function getBlobStore(env = process.env) {
  if (env.SYNC_TEST_MEMORY === '1') return memoryStore();
  const { getStore } = await import('@netlify/blobs');
  const s = getStore('oneul-sync');
  return { get: (k) => s.get(k, { type: 'json' }), setJSON: (k, v) => s.setJSON(k, v) };
}

async function sha256Hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function createHandler({ getStore = getBlobStore, env = process.env } = {}) {
  return async (req) => {
    try {
      const key = req.headers.get('x-sync-key') || '';
      if (key.length < 24) return jsonResponse({ ok: false, code: 'NO_KEY', message: '동기화 키가 없거나 너무 짧습니다(24자 이상)' }, 401);
      if (env.SYNC_ACCESS_CODE && req.headers.get('x-sync-code') !== env.SYNC_ACCESS_CODE) return jsonResponse({ ok: false, code: 'BAD_CODE', message: '접근 코드가 올바르지 않습니다' }, 401);
      const ns = (await sha256Hex(key)).slice(0, 40);
      const store = await getStore(env);
      const op = new URL(req.url).searchParams.get('op');
      const mKey = `${ns}/manifest`;
      const rKey = (id) => `${ns}/rec/${encodeURIComponent(id)}`;

      if (req.method === 'GET' && op === 'manifest') return jsonResponse({ ok: true, manifest: (await store.get(mKey)) || {} });

      if (req.method === 'POST' && (op === 'push' || op === 'pull')) {
        const text = await req.text();
        if (text.length > MAX_BODY) return jsonResponse({ ok: false, code: 'TOO_LARGE', message: '요청이 너무 큽니다(4MB 제한)' }, 413);
        const body = JSON.parse(text || '{}');
        if (op === 'pull') {
          const ids = (body.ids || []).slice(0, 60);
          const records = [];
          for (const id of ids) { const r = await store.get(rKey(id)); if (r) records.push(r); }
          return jsonResponse({ ok: true, records });
        }
        const manifest = (await store.get(mKey)) || {};
        let accepted = 0, skipped = 0;
        for (const r of body.records || []) {
          if (!r?.id || typeof r.u !== 'number') continue;
          if (manifest[r.id] && manifest[r.id].u >= r.u) { skipped++; continue; }
          await store.setJSON(rKey(r.id), r);
          manifest[r.id] = { u: r.u, ...(r.d ? { d: 1 } : {}), ...(r.doc ? { doc: r.doc } : {}) };
          accepted++;
        }
        await store.setJSON(mKey, manifest);
        return jsonResponse({ ok: true, accepted, skipped });
      }
      return jsonResponse({ ok: false, code: 'BAD_REQUEST', message: '지원하지 않는 요청입니다' }, 400);
    } catch (e) {
      const unavailable = /netlify\/blobs|MissingBlobsEnvironment|Cannot find/i.test(String(e?.message || e) + String(e?.name));
      return jsonResponse({ ok: false, code: unavailable ? 'SYNC_UNAVAILABLE' : 'ERROR', message: unavailable ? 'Netlify Blobs 를 사용할 수 없습니다. Netlify 에 배포된 환경에서만 동기화가 동작합니다' : String(e?.message || e) }, unavailable ? 503 : 500);
    }
  };
}

export default createHandler();
