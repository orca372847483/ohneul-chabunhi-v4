// IndexedDB 래퍼. 모든 쓰기는 트랜잭션 완료(oncomplete)를 기다린 뒤 resolve 한다.
const NAME = 'ohneul-chabunhi-v4';
const VERSION = 2; // v2: bookmarks·studylog·todos 추가(기존 저장소는 그대로 두고 새 저장소만 만든다)

const SCHEMA = {
  docs: { keyPath: 'id', indexes: { hash: 'hash', year: 'year' } },
  files: { keyPath: 'id' },
  texts: { keyPath: 'docId' },
  ink: { keyPath: 'key', indexes: { docId: 'docId' } },
  memos: { keyPath: 'key', indexes: { docId: 'docId' } },
  passages: { keyPath: 'id', indexes: { docId: 'docId' } },
  sessions: { keyPath: 'id', indexes: { docId: 'docId' } },
  logs: { keyPath: 'id' },
  meta: { keyPath: 'key' },
  tombstones: { keyPath: 'id' },
  bookmarks: { keyPath: 'id', indexes: { docId: 'docId' } },
  studylog: { keyPath: 'id', indexes: { date: 'date' } },
  todos: { keyPath: 'id', indexes: { date: 'date' } },
};
export const SYNC_STORES = ['docs', 'ink', 'memos', 'passages', 'sessions', 'bookmarks', 'studylog', 'todos'];

let dbp = null;
export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다'));
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [name, def] of Object.entries(SCHEMA)) {
        const st = d.objectStoreNames.contains(name) ? req.transaction.objectStore(name) : d.createObjectStore(name, { keyPath: def.keyPath });
        for (const [iname, path] of Object.entries(def.indexes || {})) if (!st.indexNames.contains(iname)) st.createIndex(iname, path);
      }
    };
    req.onsuccess = () => { const d = req.result; d.onversionchange = () => { d.close(); dbp = null; }; resolve(d); };
    req.onerror = () => reject(req.error || new Error('저장소를 열 수 없습니다'));
    req.onblocked = () => reject(new Error('다른 탭이 저장소를 사용 중입니다. 다른 탭을 닫고 새로고침하세요'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

async function run(stores, mode, fn) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(stores, mode);
    let out;
    const r = fn(Array.isArray(stores) ? Object.fromEntries(stores.map((s) => [s, tx.objectStore(s)])) : tx.objectStore(stores), tx);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('저장 트랜잭션이 취소되었습니다'));
  });
}

export const dbx = {
  get: (s, k) => run(s, 'readonly', (st) => st.get(k)),
  all: (s) => run(s, 'readonly', (st) => st.getAll()),
  put: (s, v) => run(s, 'readwrite', (st) => st.put(v)),
  putMany: (s, arr) => run(s, 'readwrite', (st) => { arr.forEach((v) => st.put(v)); }),
  del: (s, k) => run(s, 'readwrite', (st) => st.delete(k)),
  byIndex: (s, i, v) => run(s, 'readonly', (st) => st.index(i).getAll(v)),
  clear: (s) => run(s, 'readwrite', (st) => st.clear()),
  async delByIndex(s, i, v) {
    await run(s, 'readwrite', (st) => {
      const c = st.index(i).openKeyCursor(IDBKeyRange.only(v));
      c.onsuccess = () => { const cur = c.result; if (cur) { st.delete(cur.primaryKey); cur.continue(); } };
    });
  },
  run,
};

export const getMeta = async (key, d = null) => (await dbx.get('meta', key))?.value ?? d;
export const setMeta = (key, value) => dbx.put('meta', { key, value });

/** 문서 저장(수정 시각 갱신: 동기화에서 최신 판별에 사용) */
export async function saveDoc(doc, { silent = false } = {}) {
  if (!silent) doc.updatedAt = Date.now();
  await dbx.put('docs', doc);
  return doc;
}

export async function deleteDocCascade(docId) {
  const now = Date.now();
  await run(['docs', 'files', 'texts', 'tombstones'], 'readwrite', (s) => {
    s.docs.delete(docId); s.files.delete(docId); s.texts.delete(docId);
    s.tombstones.put({ id: `docs|${docId}`, docId, u: now });
  });
  // 공부 시간 기록(sessions)은 자료를 지워도 남긴다(달력·일일 기록이 줄어들지 않도록). 제목은 기록에 이미 복사돼 있다.
  for (const st of ['ink', 'memos', 'passages', 'bookmarks']) await dbx.delByIndex(st, 'docId', docId);
}

/** 기록 하나 삭제 + 동기화용 삭제 표시 */
export async function delRecord(store, id) {
  await run([store, 'tombstones'], 'readwrite', (s) => { s[store].delete(id); s.tombstones.put({ id: `${store}|${id}`, u: Date.now() }); });
}

export async function requestPersistence() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
export async function storageEstimate() {
  try { const e = await navigator.storage?.estimate?.(); return e ? { used: e.usage || 0, quota: e.quota || 0 } : null; } catch { return null; }
}
