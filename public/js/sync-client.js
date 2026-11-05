// 클라우드 동기화 클라이언트 (Netlify Blobs 기반 /api/sync). PDF 원본은 동기화하지 않는다(저작권·용량).
// 레코드 단위 Last-Write-Wins(updatedAt 이 더 최근인 쪽). 삭제는 tombstone 으로 전파.
import { dbx, getMeta, setMeta, saveDoc, deleteDocCascade } from './db.js';
import { lsGet, lsSet, h, toast, pad } from './util.js';
import { emit } from './events.js';

const CFG = 'sync-v4';
const STORES = ['docs', 'ink', 'memos', 'passages', 'sessions', 'bookmarks', 'studylog', 'todos'];
const BATCH_BYTES = 2_500_000;
let state = { status: 'off', msg: '꺼짐', at: 0 };
let listeners = new Set(), timer = null, running = false;

export const syncConfig = () => lsGet(CFG, { key: '', code: '', auto: true });
export const saveSyncConfig = (c) => lsSet(CFG, c);
export const onSyncState = (f) => { listeners.add(f); f(state); return () => listeners.delete(f); };
const set = (status, msg) => { state = { status, msg, at: Date.now() }; listeners.forEach((f) => f(state)); };
export const newKey = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');

const idOf = (store, rec) => `${store}|${rec.key || rec.id}`;
function slim(store, rec) {
  if (store === 'passages') { const { body, qtext, ...r } = rec; return r; } // 본문은 기기에서 PDF 로 다시 만들 수 있어 전송하지 않음
  if (store === 'docs') { const { analysis, ...r } = rec; return { ...r, hasFile: false }; }
  return rec;
}

async function call(op, { method = 'GET', body } = {}) {
  const c = syncConfig();
  const headers = { 'x-sync-key': c.key };
  if (c.code) headers['x-sync-code'] = c.code;
  if (body) headers['content-type'] = 'application/json';
  let res;
  try { res = await fetch('/api/sync?op=' + op, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('서버에 연결하지 못했어요(오프라인일 수 있어요)'); }
  let j = null; try { j = await res.json(); } catch { /* html */ }
  if (!j) throw new Error('서버 기능을 찾을 수 없어요(배포 환경에서만 동기화가 동작해요)');
  if (!res.ok || j.ok === false) throw new Error(j.message || `동기화 오류(${res.status})`);
  return j;
}

async function localIndex() {
  const idx = new Map();
  for (const s of STORES) for (const r of await dbx.all(s)) idx.set(idOf(s, r), { s, r });
  const tombs = await dbx.all('tombstones');
  return { idx, tombs };
}

export async function syncNow({ silent = false } = {}) {
  const c = syncConfig();
  if (!c.key) return set('off', '꺼짐');
  if (running) return;
  running = true; set('busy', '동기화 중…');
  try {
    const { manifest } = await call('manifest');
    const { idx, tombs } = await localIndex();
    // ---- 올리기 ----
    const up = [];
    for (const [id, { s, r }] of idx) {
      const u = r.updatedAt || 0;
      if (!manifest[id] || manifest[id].u < u) up.push({ id, u, data: slim(s, r), ...(s === 'docs' ? { doc: { t: r.title } } : {}) });
    }
    for (const t of tombs) { const id = t.id; if (!manifest[id] || manifest[id].u < t.u) up.push({ id, u: t.u, d: 1 }); }
    let sent = 0;
    for (let i = 0; i < up.length;) {
      const batch = []; let bytes = 0;
      while (i < up.length && (bytes < BATCH_BYTES || !batch.length)) { bytes += JSON.stringify(up[i]).length; batch.push(up[i++]); }
      await call('push', { method: 'POST', body: { records: batch } }); sent += batch.length;
    }
    // ---- 받기 ----
    const down = [];
    for (const [id, m] of Object.entries(manifest)) {
      const l = idx.get(id);
      const lu = l ? (l.r.updatedAt || 0) : 0;
      const tomb = tombs.find((t) => t.id === id);
      if (m.d) { if (l && m.u > lu) down.push(id); continue; }
      if (tomb && tomb.u >= m.u) continue; // 이쪽에서 이미 삭제함
      const [st, ...ks] = id.split('|');
      if (['ink', 'memos', 'passages', 'bookmarks'].includes(st)) { // 삭제된 자료의 하위 기록이 되살아나지 않게
        const parent = `docs|${ks[0]}`;
        if (tombs.some((t) => t.id === parent) || manifest[parent]?.d) continue;
      }
      if (!l || m.u > lu) down.push(id);
    }
    let got = 0;
    for (let i = 0; i < down.length; i += 40) {
      const { records } = await call('pull', { method: 'POST', body: { ids: down.slice(i, i + 40) } });
      for (const r of records) { await applyRemote(r); got++; }
    }
    await setMeta('lastSync', Date.now());
    const d = new Date();
    set('ok', `완료 ${pad(d.getHours())}:${pad(d.getMinutes())} (↑${sent} ↓${got})`);
    if (got) emit('data');
    if (!silent && (sent || got)) toast(`동기화 완료: 올림 ${sent} · 받음 ${got}`);
  } catch (e) { set('err', e.message); if (!silent) toast(`동기화 실패: ${e.message}`, 'error', 7000); }
  finally { running = false; }
}

async function applyRemote(r) {
  const [store, ...rest] = r.id.split('|'); const key = rest.join('|');
  if (r.d) { // 원격 삭제
    if (store === 'docs') await deleteDocCascade(key);
    else if (STORES.includes(store)) await dbx.del(store, key);
    return;
  }
  const rec = r.data; if (!rec) return;
  if (store === 'docs') {
    const old = await dbx.get('docs', rec.id);
    if (old?.hasFile) { rec.hasFile = true; rec.hash = old.hash; rec.size = old.size; rec.pages = old.pages; rec.analysis = old.analysis; }
    await saveDoc(rec, { silent: true });
  } else if (store === 'passages') {
    const old = await dbx.get('passages', rec.id);
    await dbx.put('passages', { ...rec, body: old?.body || '', qtext: old?.qtext || '' });
  } else if (STORES.includes(store)) await dbx.put(store, rec);
}

export function scheduleSync(ms = 20000) {
  const c = syncConfig(); if (!c.key || !c.auto) return;
  clearTimeout(timer); timer = setTimeout(() => syncNow({ silent: true }), ms);
}
export function initSync() {
  const c = syncConfig();
  set(c.key ? 'idle' : 'off', c.key ? '대기' : '꺼짐');
  if (c.key) syncNow({ silent: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') scheduleSync(500); });
  window.addEventListener('online', () => scheduleSync(1500));
}

/** 설정 화면의 동기화 영역 */
export function syncPanel() {
  const c = syncConfig();
  const key = h('input', { type: 'text', value: c.key, placeholder: '동기화 키(24자 이상)', style: 'width:100%;font-family:ui-monospace,monospace', autocapitalize: 'off', autocomplete: 'off', spellcheck: false });
  const code = h('input', { type: 'password', value: c.code, placeholder: '접근 코드(서버에 설정한 경우)', style: 'width:100%' });
  const auto = h('input', { type: 'checkbox', checked: c.auto !== false });
  const stat = h('div', { class: 'muted' });
  onSyncState((s) => { stat.textContent = `상태: ${s.msg}`; });
  const persist = () => saveSyncConfig({ key: key.value.trim(), code: code.value, auto: auto.checked });
  return h('div', {},
    h('div', { class: 'muted', style: 'line-height:1.6', text: '같은 동기화 키를 입력한 기기끼리 필기·메모·분류·풀이 기록을 맞춰요. PDF 파일은 올리지 않아요(다른 기기에서는 공식 출처에서 다시 받거나 직접 연결). 키를 아는 사람은 누구나 기록을 볼 수 있으니 비밀로 하세요.' }),
    h('div', { class: 'field' }, h('label', { text: '동기화 키' }), key),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', text: '새 키 만들기', onclick: () => { key.value = newKey(); persist(); } }), h('button', { class: 'btn sm', text: '키 복사', onclick: async () => { try { await navigator.clipboard.writeText(key.value); toast('복사했어요'); } catch { toast('복사하지 못했어요. 직접 선택해 복사하세요', 'error'); } } })),
    h('div', { class: 'field' }, h('label', { text: '접근 코드(선택)' }), code),
    h('label', { class: 'row', style: 'margin:6px 0' }, auto, '변경 후 자동 동기화'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', text: '지금 동기화', onclick: async () => { persist(); if (key.value.trim().length < 24) return toast('동기화 키는 24자 이상이어야 해요. “새 키 만들기”를 누르세요', 'error'); await syncNow(); } }),
      h('button', { class: 'btn', text: '동기화 끄기', onclick: () => { key.value = ''; persist(); set('off', '꺼짐'); toast('동기화를 껐어요(기기의 데이터는 그대로예요)'); } })),
    stat);
}
void getMeta;
