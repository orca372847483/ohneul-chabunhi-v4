// 필기 엔진: 시험지 위 필기와 손글씨 메모가 같은 엔진을 쓴다.
// - 좌표는 캔버스 크기에 대한 비율(0~1)로 저장 → 확대/축소/회전/해상도 변경에도 시험지와 정확히 일치
// - 선 굵기는 max(가로,세로)/1000 단위(v3 와 동일) → v3 필기를 그대로 가져올 수 있음
// - PDF 캔버스와 별도 레이어(base/live 캔버스)라서 원본을 훼손하지 않는다
import { dbx } from './db.js';

export function paintStroke(ctx, s, W, H) {
  const pts = s.points;
  if (!pts || !pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const base = s.width * Math.max(W, H) / 1000 * (s.highlight ? 3 : 1);
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'; // v3 의 지우개 획(레거시)
  ctx.strokeStyle = s.color || '#000';
  ctx.fillStyle = s.color || '#000';
  ctx.globalAlpha = s.highlight ? 0.28 : 1;
  const X = (p) => p[0] * W, Y = (p) => p[1] * H;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(X(pts[0]), Y(pts[0]), Math.max(0.6, base / 2), 0, Math.PI * 2);
    ctx.fill();
  } else if (!s.highlight && pts.some((p) => p[2] != null)) {
    // 필압(Apple Pencil)에 따라 굵기 변화
    for (let i = 1; i < pts.length; i++) {
      const p = ((pts[i][2] ?? 0.5) + (pts[i - 1][2] ?? 0.5)) / 2;
      ctx.lineWidth = Math.max(0.5, base * (0.35 + 1.3 * p));
      ctx.beginPath(); ctx.moveTo(X(pts[i - 1]), Y(pts[i - 1])); ctx.lineTo(X(pts[i]), Y(pts[i])); ctx.stroke();
    }
  } else {
    ctx.lineWidth = Math.max(0.5, base);
    ctx.beginPath();
    ctx.moveTo(X(pts[0]), Y(pts[0]));
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(X(pts[i]), Y(pts[i]), (X(pts[i]) + X(pts[i + 1])) / 2, (Y(pts[i]) + Y(pts[i + 1])) / 2);
    }
    ctx.lineTo(X(pts[pts.length - 1]), Y(pts[pts.length - 1]));
    ctx.stroke();
  }
  ctx.restore();
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 필기 데이터(페이지 하나 분량)와 실행 취소 기록, 자동 저장을 관리한다. */
export class InkStore {
  constructor(storeName, { onState } = {}) {
    this.storeName = storeName;
    this.cache = new Map();
    this.onState = onState || (() => {});
    this.timers = new Map();
    this.pending = 0;
  }
  async open(key, docId, page) {
    if (this.cache.has(key)) return this.cache.get(key);
    const rec = await dbx.get(this.storeName, key);
    const entry = { key, docId, page, strokes: rec?.strokes || [], undo: [], redo: [], dirty: false, listeners: new Set(), updatedAt: rec?.updatedAt || 0 };
    this.cache.set(key, entry);
    return entry;
  }
  notify(e) { e.listeners.forEach((f) => f()); }
  mutate(e, action) {
    e.undo.push(action); e.redo.length = 0; this.touch(e);
  }
  add(e, stroke) { e.strokes.push(stroke); this.mutate(e, { t: 'add', s: stroke }); this.notify(e); }
  remove(e, items) { // items: [{i, s}] 오름차순
    const set = new Set(items.map((x) => x.s));
    e.strokes = e.strokes.filter((s) => !set.has(s));
    this.mutate(e, { t: 'rm', items }); this.notify(e);
  }
  clear(e) {
    if (!e.strokes.length) return false;
    const old = e.strokes; e.strokes = [];
    this.mutate(e, { t: 'clear', strokes: old }); this.notify(e); return true;
  }
  undo(e) {
    const a = e.undo.pop();
    if (!a) { // 기록이 없으면(재접속 후) v3 처럼 마지막 획을 제거
      if (!e.strokes.length) return false;
      const s = e.strokes.pop(); e.redo.push({ t: 'add', s }); this.touch(e); this.notify(e); return true;
    }
    if (a.t === 'add') e.strokes = e.strokes.filter((s) => s !== a.s);
    else if (a.t === 'rm') for (const { i, s } of a.items) e.strokes.splice(Math.min(i, e.strokes.length), 0, s);
    else if (a.t === 'clear') e.strokes = a.strokes;
    e.redo.push(a); this.touch(e); this.notify(e); return true;
  }
  redo(e) {
    const a = e.redo.pop();
    if (!a) return false;
    if (a.t === 'add') e.strokes.push(a.s);
    else if (a.t === 'rm') { const set = new Set(a.items.map((x) => x.s)); e.strokes = e.strokes.filter((s) => !set.has(s)); }
    else if (a.t === 'clear') { e.strokes = []; }
    e.undo.push(a); this.touch(e); this.notify(e); return true;
  }
  touch(e) {
    e.dirty = true; e.updatedAt = Date.now();
    this.onState('dirty');
    clearTimeout(this.timers.get(e.key));
    this.timers.set(e.key, setTimeout(() => this.save(e), 350));
  }
  async save(e) {
    if (!e.dirty) return;
    clearTimeout(this.timers.get(e.key));
    e.dirty = false; this.pending++; this.onState('saving');
    try {
      await dbx.put(this.storeName, { key: e.key, docId: e.docId, page: e.page, strokes: e.strokes, updatedAt: e.updatedAt });
      this.pending--; if (!this.pending) this.onState('saved');
    } catch (err) {
      this.pending--; e.dirty = true;
      this.onState('error', err?.name === 'QuotaExceededError' ? '저장 공간이 부족합니다. 불필요한 자료를 삭제하세요' : `필기 저장 실패: ${err?.message || err}`);
    }
  }
  async flush() { await Promise.all([...this.cache.values()].filter((e) => e.dirty).map((e) => this.save(e))); }
  forget(docId) { for (const [k, e] of this.cache) if (e.docId === docId) { clearTimeout(this.timers.get(k)); this.cache.delete(k); } }
  forgetAll() { this.cache.clear(); }
}

let lastPen = 0; // 팜 리젝션: 최근 펜 입력이 있었으면 손바닥 터치 무시

export class InkLayer {
  /**
   * @param {{base:HTMLCanvasElement, live:HTMLCanvasElement, store:InkStore, entry:object, tools:()=>object, onActive?:(layer)=>void, touchBlocked?:()=>boolean}} o
   */
  constructor(o) {
    Object.assign(this, o);
    this.cur = null; this.erasing = null; this.pid = null; this.raf = 0; this.W = 1; this.H = 1; this.cssW = 1; this.cssH = 1;
    this.entry.listeners.add(this._redrawBound = () => this.redraw());
    const L = this.live;
    L.style.touchAction = 'none';
    this._on = {
      pointerdown: (e) => this._down(e), pointermove: (e) => this._move(e),
      pointerup: (e) => this._up(e), pointercancel: (e) => this._up(e),
      contextmenu: (e) => e.preventDefault(),
    };
    for (const [k, f] of Object.entries(this._on)) L.addEventListener(k, f);
  }
  destroy() {
    this.entry.listeners.delete(this._redrawBound);
    for (const [k, f] of Object.entries(this._on)) this.live.removeEventListener(k, f);
    cancelAnimationFrame(this.raf);
  }
  resize(cssW, cssH, dpr) {
    this.cssW = cssW; this.cssH = cssH;
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    for (const c of [this.base, this.live]) { c.width = w; c.height = h; c.style.width = cssW + 'px'; c.style.height = cssH + 'px'; }
    this.W = w; this.H = h; this.redraw();
  }
  redraw() {
    const ctx = this.base.getContext('2d');
    ctx.clearRect(0, 0, this.W, this.H);
    for (const s of this.entry.strokes) paintStroke(ctx, s, this.W, this.H);
  }
  _pt(e) {
    const r = this.live.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 10000) / 10000;
    const y = Math.round(((e.clientY - r.top) / r.height) * 10000) / 10000;
    return e.pointerType === 'pen' && e.pressure > 0 ? [x, y, Math.round(e.pressure * 100) / 100] : [x, y];
  }
  _down(e) {
    const t = this.tools();
    if (t.input === 'view') return;
    if (e.pointerType === 'pen') lastPen = performance.now();
    if (e.pointerType === 'touch') {
      if (t.input === 'pen' || performance.now() - lastPen < 1200 || this.touchBlocked?.()) return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.pid != null) return;
    e.preventDefault();
    this.pid = e.pointerId;
    try { this.live.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저 */ }
    this.onActive?.(this);
    const p = this._pt(e);
    if (t.tool === 'eraser') { this.erasing = { removed: [] }; this._erase(p, t); }
    else this.cur = { color: t.color, width: t.width, highlight: t.tool === 'highlighter', points: [p] };
    this._schedule();
  }
  _move(e) {
    if (e.pointerId !== this.pid) return;
    if (e.pointerType === 'pen') lastPen = performance.now();
    const t = this.tools();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      const p = this._pt(ev);
      if (this.erasing) this._erase(p, t);
      else if (this.cur) {
        const q = this.cur.points[this.cur.points.length - 1];
        if (Math.abs(q[0] - p[0]) * this.cssW + Math.abs(q[1] - p[1]) * this.cssH >= 0.6) this.cur.points.push(p);
      }
    }
    this.eraserAt = this.erasing ? this._pt(e) : null;
    this._schedule();
  }
  _up(e) {
    if (e.pointerId !== this.pid) return;
    this.pid = null;
    try { this.live.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    this.commit();
  }
  /** 두 손가락 제스처 시작 등으로 진행 중인 획을 버린다(지우개는 이미 지운 만큼 확정) */
  cancelActive() {
    if (this.pid == null) return;
    this.pid = null;
    if (this.cur) this.cur = null;
    this.commit();
  }
  commit() {
    if (this.cur) { this.store.add(this.entry, this.cur); this.cur = null; }
    if (this.erasing) {
      if (this.erasing.removed.length) {
        const items = this.erasing.removed.sort((a, b) => a.i - b.i);
        // 이미 _erase 에서 화면에서는 제거됨 → 기록용으로 한 번에 확정
        this.store.mutate(this.entry, { t: 'rm', items });
      }
      this.erasing = null; this.eraserAt = null;
    }
    this._schedule(true);
  }
  _erase(p, t) {
    const r = Math.max(8, t.width * 2.2 + 6); // CSS px
    const px = p[0] * this.cssW, py = p[1] * this.cssH;
    const strokes = this.entry.strokes;
    let changed = false;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (s.erase) continue;
      const pts = s.points;
      let hit = false;
      const w = (s.width * Math.max(this.cssW, this.cssH) / 1000 * (s.highlight ? 3 : 1)) / 2;
      for (let k = 0; k < pts.length && !hit; k++) {
        const ax = pts[k][0] * this.cssW, ay = pts[k][1] * this.cssH;
        if (k === 0 && pts.length === 1) hit = Math.hypot(px - ax, py - ay) <= r + w;
        else if (k > 0) hit = distSeg(px, py, pts[k - 1][0] * this.cssW, pts[k - 1][1] * this.cssH, ax, ay) <= r + w;
      }
      if (hit) { this.erasing.removed.push({ i, s }); strokes.splice(i, 1); changed = true; }
    }
    if (changed) this.redraw();
  }
  _schedule(clearOnly = false) {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const ctx = this.live.getContext('2d');
      ctx.clearRect(0, 0, this.W, this.H);
      if (clearOnly) return;
      if (this.cur) paintStroke(ctx, this.cur, this.W, this.H);
      if (this.eraserAt) {
        const t = this.tools();
        const r = Math.max(8, t.width * 2.2 + 6) * (this.W / this.cssW);
        ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.2; ctx.beginPath();
        ctx.arc(this.eraserAt[0] * this.W, this.eraserAt[1] * this.H, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
    });
  }
}
