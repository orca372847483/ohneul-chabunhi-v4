// v3(korean-exam-study-room-v2 DB)의 PDF·필기·메모를 v4 로 가져온다. 원본 DB 는 지우지 않는다(안전).
import { dbx, getMeta, setMeta } from './db.js';
import { addPdf } from './docs.js';
import { setNoteLabel } from './memo.js';
import { examLabel } from './util.js';

const OLD = 'korean-exam-study-room-v2';
const EXAM_MAP = { '수능': ['csat', null], '6월 모의평가': ['jun', null], '9월 모의평가': ['sep', null], '교육청 3월': ['office', 3], '교육청 4월': ['office', 4], '교육청 7월': ['office', 7], '교육청 10월': ['office', 10] };

function openOld() {
  return new Promise((resolve) => {
    const r = indexedDB.open(OLD);
    r.onupgradeneeded = () => { r.transaction.abort(); resolve(null); }; // 없던 DB 를 새로 만들지 않는다
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
}
const all = (db, store) => new Promise((res) => {
  if (!db.objectStoreNames.contains(store)) return res([]);
  const out = []; const c = db.transaction(store).objectStore(store).openCursor();
  c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); };
  c.onerror = () => res(out);
});

export async function migrateV3() {
  if (await getMeta('v3Migrated', false)) return null;
  if (indexedDB.databases) { const dbs = await indexedDB.databases(); if (!dbs.some((d) => d.name === OLD)) { await setMeta('v3Migrated', true); return null; } }
  const old = await openOld();
  if (!old) { await setMeta('v3Migrated', true); return null; }
  const res = { docs: 0, marks: 0, memos: 0, skipped: 0, errors: [] };
  try {
    const [pdfs, marks, memos] = await Promise.all([all(old, 'pdfs'), all(old, 'marks'), all(old, 'memos')]);
    const idByExam = new Map();
    for (const [k, buf] of pdfs) {
      const [yearS, examName] = String(k).split('|');
      const [exam, month] = EXAM_MAP[examName] || [null, null];
      try {
        const r = await addPdf(buf, { year: +yearS || null, exam, month, source: 'migrated', title: `${yearS}학년도 ${examLabel({ exam, month })} 국어` });
        idByExam.set(k, r.doc.id); if (r.dup) res.skipped++; else res.docs++;
      } catch (e) { res.errors.push(`${k}: ${e.message}`); }
    }
    for (const [k, strokes] of marks) { // v3 키: 학년도|시험|쪽
      const parts = String(k).split('|'); const page = +parts.pop(); const docId = idByExam.get(parts.join('|'));
      if (!docId || !Array.isArray(strokes) || !strokes.length) continue;
      const key = `${docId}|${page}`;
      if (await dbx.get('ink', key)) continue;
      await dbx.put('ink', { key, docId, page, strokes, updatedAt: Date.now() }); res.marks++;
    }
    const counters = new Map();
    for (const [k, strokes] of memos) { // v3 키: 학년도|시험|지문유형 → 자유 노트
      const parts = String(k).split('|'); const cat = parts.pop(); const examKey = parts.join('|'); const docId = idByExam.get(examKey);
      if (!docId || !Array.isArray(strokes) || !strokes.length) continue;
      const n = (counters.get(docId) || 0) + 1; counters.set(docId, n);
      const conv = strokes.map((s) => ({ color: s.color, width: Math.round(s.width * (1000 / 900) * 10) / 10, erase: !!s.erase, points: s.points.map((p) => [p.x, p.y]) }));
      await dbx.put('memos', { key: `${docId}|n${n}`, docId, page: `n${n}`, strokes: conv, updatedAt: Date.now() });
      const d = await dbx.get('docs', docId); if (d) await setNoteLabel(d, n, `v3 메모 · ${cat}`);
      res.memos++;
    }
  } finally { old.close(); }
  await setMeta('v3Migrated', true);
  return res;
}
