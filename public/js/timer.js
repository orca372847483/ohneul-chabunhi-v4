// 풀이 타이머: 시작·일시정지·재시작·종료, 자료별 기록, 문항별 기록.
// 시간은 setInterval 횟수가 아니라 Date.now() 차이로 계산한다(iPad 가 백그라운드에서 타이머를 늦추어도 정확).
// 상태는 meta 에 저장되어 새로고침해도 이어진다. 앱이 강제 종료된 경우 마지막 심장박동(15초 간격)까지만 인정한다.
import { dbx, getMeta, setMeta, saveDoc, delRecord } from './db.js';
import { uid, ymd } from './util.js';

const key = (docId) => `solve|${docId}`;

export class SolveTimer {
  constructor({ onTick, onChange }) { this.onTick = onTick; this.onChange = onChange; this.docId = null; this.s = null; this.iv = null; this.beat = null; }

  blank(docId) { return { status: 'idle', acc: 0, startedAt: 0, sessionStart: 0, lastQ: 0, qlogs: [], docId }; }

  async attach(docId) {
    this.detachLoop();
    this.docId = docId;
    const saved = await getMeta(key(docId), null);
    this.s = saved || this.blank(docId);
    if (this.s.status === 'running') { // 비정상 종료 복구
      const lastBeat = this.s.beat || this.s.startedAt;
      this.s.acc += Math.max(0, lastBeat - this.s.startedAt) / 1000;
      this.s.status = 'paused'; this.s.startedAt = 0; this.s.recovered = true;
      await this.persist();
    }
    this.emit();
  }
  elapsed() { const s = this.s; if (!s) return 0; return s.acc + (s.status === 'running' ? (Date.now() - s.startedAt) / 1000 : 0); }
  get status() { return this.s?.status || 'idle'; }

  emit() { this.onTick?.(this.elapsed(), this.status); this.onChange?.(this.snapshot()); }
  snapshot() { return { status: this.status, seconds: this.elapsed(), qlogs: this.s?.qlogs || [], recovered: !!this.s?.recovered }; }
  async persist() { if (this.s) await setMeta(key(this.docId), this.s); }

  startLoop() {
    this.detachLoop();
    this.iv = setInterval(() => this.onTick?.(this.elapsed(), this.status), 250);
    this.beat = setInterval(() => { if (this.s?.status === 'running') { this.s.beat = Date.now(); this.persist(); } }, 15000);
  }
  detachLoop() { clearInterval(this.iv); clearInterval(this.beat); this.iv = this.beat = null; }

  async start() {
    if (!this.s || this.s.status === 'running') return;
    const first = this.s.status === 'idle';
    this.s.status = 'running'; this.s.startedAt = Date.now(); this.s.beat = Date.now(); this.s.recovered = false;
    if (first) this.s.sessionStart = Date.now();
    this.startLoop(); await this.persist(); this.emit();
  }
  async pause() {
    if (this.s?.status !== 'running') return;
    this.s.acc += (Date.now() - this.s.startedAt) / 1000; this.s.status = 'paused'; this.s.startedAt = 0;
    this.detachLoop(); await this.persist(); this.emit();
  }
  /** 화면을 벗어날 때: 흐르던 시간을 일시정지로 확정(저장은 끝까지 기다린다) */
  async leave() { await this.pause(); this.detachLoop(); }

  /** 문항별 기록: 직전 기록 이후 걸린 시간을 해당 문항에 남긴다 */
  async lap(q, mark = '') {
    if (!this.s || this.s.status === 'idle') throw new Error('풀이를 시작한 뒤에 문항 기록을 남길 수 있어요');
    const t = this.elapsed();
    this.s.qlogs.push({ q: +q || null, sec: Math.round(t - this.s.lastQ), at: Math.round(t), mark });
    this.s.lastQ = t; await this.persist(); this.emit();
  }
  async removeLap(i) { this.s.qlogs.splice(i, 1); await this.persist(); this.emit(); }

  /** 풀이 종료 → 세션 기록으로 저장하고 자료 합계에 더한다. 0초면 저장하지 않는다 */
  async stop(extra = {}) {
    if (!this.s || this.s.status === 'idle') return null;
    await this.pause();
    const seconds = Math.round(this.s.acc);
    let rec = null;
    if (seconds >= 1) {
      const d = await dbx.get('docs', this.docId);
      const now = Date.now();
      rec = { id: uid(), docId: this.docId, title: d?.title || (this.docId === '__free__' ? '자유 공부' : '삭제된 자료'), date: ymd(now), startTs: this.s.sessionStart, endTs: now, seconds, qlogs: this.s.qlogs, updatedAt: now, ...extra };
      await dbx.put('sessions', rec);
      if (d) { d.solveSec = (d.solveSec || 0) + seconds; d.solveCount = (d.solveCount || 0) + 1; d.lastSolvedAt = Date.now(); await saveDoc(d); }
    }
    this.s = this.blank(this.docId); await this.persist(); this.emit();
    return rec;
  }
  async reset() { this.s = this.blank(this.docId); this.detachLoop(); await this.persist(); this.emit(); }
}

export async function deleteSession(rec) {
  await delRecord('sessions', rec.id);
  const d = await dbx.get('docs', rec.docId);
  if (d) { d.solveSec = Math.max(0, (d.solveSec || 0) - rec.seconds); d.solveCount = Math.max(0, (d.solveCount || 0) - 1); await saveDoc(d); }
}
