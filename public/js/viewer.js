// 시험지 뷰어: 1·2쪽 펼침, 확대/축소(핀치 포함), 화면 맞춤, 페이지 위에 겹치는 필기 레이어
import { loadPdf, destroyPdf } from './pdfjs.js';
import { InkLayer } from './ink.js';

const GAP = 10, PAD = 12, LABEL = 18, MAX_Z = 3, MIN_Z = 0.5, MAX_PIXELS = 8e6;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Reader {
  /**
   * @param {{paper:HTMLElement, spread:HTMLElement, store:import('./ink.js').InkStore, tools:()=>object, onChange?:Function, onActive?:Function}} o
   */
  constructor(o) {
    Object.assign(this, o);
    this.hlQuery = ''; this.pdf = null; this.doc = null; this.page = 1; this.total = 0; this.z = 1; this.pref = 'auto';
    this.boxes = []; this.token = 0; this.sizes = new Map(); this.touches = new Map(); this.active = null;
    this._rerender = null;
    this._bindGestures();
    this._ro = new ResizeObserver(() => { if (this.pdf) { clearTimeout(this._rt); this._rt = setTimeout(() => this._onResize(), 120); } });
    this._ro.observe(this.paper);
  }

  /* ---------- 열기/닫기 ---------- */
  async open(doc, buf, page = 1) {
    this.close();
    this.doc = doc;
    this.pdf = await loadPdf(buf);
    this.total = this.pdf.numPages; this.z = 1; this.sizes.clear();
    this.page = clamp(page, 1, this.total);
    await this.render();
  }
  close() {
    this.token++;
    this._teardown();
    destroyPdf(this.pdf);
    this.pdf = null; this.doc = null; this.total = 0; this.spread.replaceChildren();
  }
  _teardown() {
    for (const b of this.boxes) { b.layer?.destroy(); try { b.task?.cancel(); } catch { /* ignore */ } }
    this.boxes = []; this.active = null;
  }

  /* ---------- 쪽 계산 ---------- */
  get spreadCount() {
    if (this.pref === '1') return 1;
    if (this.pref === '2') return 2;
    const w = this.paper.clientWidth, h = this.paper.clientHeight;
    return w >= 820 && w > h * 1.05 ? 2 : 1; // 가로 화면(아이패드 가로 등)만 자동 2쪽
  }
  get pages() {
    const n = this.spreadCount;
    const left = n === 2 ? (this.page % 2 === 0 ? this.page - 1 : this.page) : this.page;
    const out = [left];
    if (n === 2 && left + 1 <= this.total) out.push(left + 1);
    return out;
  }
  get activeEntry() { return (this.active || this.boxes[0]?.layer)?.entry || null; }

  async _size(n) {
    if (this.sizes.has(n)) return this.sizes.get(n);
    const p = await this.pdf.getPage(n);
    const vp = p.getViewport({ scale: 1 });
    const s = { w: vp.width, h: vp.height };
    this.sizes.set(n, s);
    return s;
  }
  _fit(sizes) {
    const cw = this.paper.clientWidth - PAD * 2, ch = this.paper.clientHeight - PAD * 2 - LABEL;
    const sumW = sizes.reduce((a, s) => a + s.w, 0) + GAP * (sizes.length - 1);
    const maxH = Math.max(...sizes.map((s) => s.h));
    return Math.max(0.05, Math.min(cw / sumW, ch / maxH));
  }

  /* ---------- 그리기 ---------- */
  async render() {
    if (!this.pdf) return;
    const tk = ++this.token;
    const nums = this.pages;
    const sizes = await Promise.all(nums.map((n) => this._size(n)));
    if (tk !== this.token) return;
    this._teardown();
    this.spread.replaceChildren();
    this.fit = this._fit(sizes);
    for (let i = 0; i < nums.length; i++) {
      const n = nums[i];
      const box = document.createElement('div'); box.className = 'pbox'; box.dataset.page = n;
      const pdfC = document.createElement('canvas');
      const base = document.createElement('canvas'), live = document.createElement('canvas'); live.className = 'live';
      const pn = document.createElement('div'); pn.className = 'pn'; pn.textContent = `${n} / ${this.total}`;
      box.append(pdfC, base, live, pn);
      this.spread.append(box);
      const entry = await this.store.open(`${this.doc.id}|${n}`, this.doc.id, n);
      if (tk !== this.token) return;
      const b = { n, box, pdfC, size: sizes[i], entry, rendered: 0 };
      b.layer = new InkLayer({ base, live, store: this.store, entry, tools: this.tools, onActive: (l) => { this.active = l; this.onActive?.(l); }, touchBlocked: () => this.touches.size >= 2 });
      this.boxes.push(b);
    }
    this.layout();
    this.onChange?.(this.state());
    this.boxes.forEach((b) => this._highlight(b, tk));
    await this._renderPdfAll(tk);
  }

  layout() {
    const sc = this.fit * this.z;
    const dpr = window.devicePixelRatio || 1;
    for (const b of this.boxes) {
      const w = b.size.w * sc, h = b.size.h * sc;
      b.box.style.width = w + 'px'; b.box.style.height = h + 'px';
      b.cssW = w; b.cssH = h;
      const d = Math.max(0.5, Math.min(dpr, Math.sqrt(MAX_PIXELS / (w * h))));
      b.layer.resize(w, h, d);
      b.box.style.setProperty('--n', b.n);
    }
    this.onChange?.(this.state());
  }

  async _renderPdfAll(tk) {
    for (const b of this.boxes) { if (tk !== this.token) return; await this._renderPdf(b, tk); }
  }
  async _renderPdf(b, tk) {
    const dpr = window.devicePixelRatio || 1;
    const d = Math.max(0.5, Math.min(dpr * 1.25, Math.sqrt(MAX_PIXELS / (b.cssW * b.cssH))));
    const target = b.cssW * d;
    if (b.rendered && Math.abs(b.rendered - target) / target < 0.04) return;
    try { b.task?.cancel(); } catch { /* ignore */ }
    const page = await this.pdf.getPage(b.n);
    if (tk !== this.token) return;
    const vp = page.getViewport({ scale: target / b.size.w });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    b.task = page.render({ canvasContext: ctx, canvas: cv, viewport: vp });
    try { await b.task.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; this.onError?.(e); return; }
    if (tk !== this.token) return;
    cv.style.width = '100%'; cv.style.height = '100%';
    b.pdfC.replaceWith(cv); b.pdfC = cv; b.rendered = target;
  }
  /** 검색어가 들어 있는 글줄에 표시(글줄 단위 근사 위치) */
  async _highlight(b, tk) {
    b.box.querySelectorAll('.hl').forEach((x) => x.remove());
    const q = (this.hlQuery || '').toLowerCase().replace(/\s+/g, '');
    if (!q) return;
    try {
      const page = await this.pdf.getPage(b.n); if (tk !== this.token) return;
      const tc = await page.getTextContent(); const vp = page.getViewport({ scale: 1 });
      for (const it of tc.items) {
        const t = (it.str || '').toLowerCase().replace(/\s+/g, ''); const i = t.indexOf(q);
        if (!t || i < 0) continue;
        const hgt = it.height || Math.abs(it.transform[3]) || 10, x = it.transform[4] + (it.width * i) / t.length, w = Math.max((it.width * q.length) / t.length, 4), top = vp.height - it.transform[5] - hgt * 0.9;
        const d = document.createElement('div'); d.className = 'hl';
        d.style.cssText = `left:${(x / vp.width) * 100}%;top:${(top / vp.height) * 100}%;width:${(w / vp.width) * 100}%;height:${((hgt * 1.15) / vp.height) * 100}%`;
        b.box.insertBefore(d, b.box.querySelector('canvas:nth-of-type(2)') || null);
      }
    } catch { /* 강조 실패는 무시 */ }
  }
  setHighlight(q) { this.hlQuery = q || ''; this.boxes.forEach((b) => this._highlight(b, this.token)); }
  _scheduleHiRes() {
    clearTimeout(this._rerender);
    const tk = this.token;
    this._rerender = setTimeout(async () => { for (const b of this.boxes) { if (tk !== this.token) return; await this._renderPdf(b, tk); } }, 160);
  }

  _onResize() {
    if (!this.pdf) return;
    const before = this.pages.join(',');
    if (this._wasCount !== this.spreadCount) { this._wasCount = this.spreadCount; this.render(); return; }
    this.fit = this._fit(this.boxes.map((b) => b.size));
    this.layout(); this._scheduleHiRes();
    void before;
  }

  /* ---------- 조작 ---------- */
  state() { return { page: this.pages[0], pages: this.pages, total: this.total, z: this.z, mode: this.pref, count: this.spreadCount }; }
  async goto(n) {
    if (!this.pdf) return;
    this.page = clamp(Math.round(+n) || 1, 1, this.total);
    this._wasCount = this.spreadCount;
    await this.render();
    this.paper.scrollTo(0, 0);
  }
  next() { const last = this.pages[this.pages.length - 1]; if (last < this.total) return this.goto(last + 1); }
  prev() { const first = this.pages[0]; if (first > 1) return this.goto(first - this.spreadCount); }
  setMode(pref) { this.pref = pref; this._wasCount = this.spreadCount; return this.render(); }
  fitScreen() { this.z = 1; this.layout(); this.paper.scrollTo(0, 0); this._scheduleHiRes(); }
  zoomBy(f, cx, cy) { this.zoomTo(this.z * f, cx, cy); }
  zoomTo(z, cx, cy) {
    const nz = clamp(z, MIN_Z, MAX_Z);
    if (Math.abs(nz - this.z) < 0.001) return;
    const r = this.paper.getBoundingClientRect();
    const ox = (cx ?? r.left + r.width / 2) - r.left, oy = (cy ?? r.top + r.height / 2) - r.top;
    const fx = this.paper.scrollLeft + ox, fy = this.paper.scrollTop + oy;
    const w0 = this.spread.offsetWidth, h0 = this.spread.offsetHeight;
    this.z = nz; this.layout();
    const w1 = this.spread.offsetWidth, h1 = this.spread.offsetHeight;
    this.paper.scrollLeft = fx * (w1 / (w0 || 1)) - ox;
    this.paper.scrollTop = fy * (h1 / (h0 || 1)) - oy;
    this._scheduleHiRes();
  }
  undo() { const e = this.activeEntry; return e ? this.store.undo(e) : false; }
  redo() { const e = this.activeEntry; return e ? this.store.redo(e) : false; }
  clearActive() { const e = this.activeEntry; return e ? this.store.clear(e) : false; }

  /* ---------- 터치 제스처: 손가락 이동·핀치(Apple Pencil 은 필기 전용) ---------- */
  _bindGestures() {
    const P = this.paper;
    let pinch = null, pan = null;
    const dist = () => { const [a, b] = [...this.touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    const center = () => { const [a, b] = [...this.touches.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    P.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) { pan = null; pinch = { d: dist(), z: this.z }; this.boxes.forEach((b) => b.layer.cancelActive()); }
      else if (this.touches.size === 1) {
        const t = this.tools();
        const onInk = e.target.classList?.contains('live');
        pan = t.input === 'all' && onInk ? null : { x: e.clientX, y: e.clientY };
      }
    }, true);
    P.addEventListener('pointermove', (e) => {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX; t.y = e.clientY;
      if (this.touches.size === 2 && pinch) {
        const c = center();
        this.zoomTo(pinch.z * (dist() / pinch.d), c.x, c.y);
      } else if (this.touches.size === 1 && pan) {
        P.scrollLeft -= e.clientX - pan.x; P.scrollTop -= e.clientY - pan.y;
        pan = { x: e.clientX, y: e.clientY };
      }
    }, true);
    const up = (e) => {
      if (!this.touches.delete(e.pointerId)) return;
      if (this.touches.size < 2) pinch = null;
      if (this.touches.size === 0) pan = null;
      else if (this.touches.size === 1) { const [r] = [...this.touches.values()]; pan = { x: r.x, y: r.y }; }
    };
    P.addEventListener('pointerup', up, true); P.addEventListener('pointercancel', up, true);
    P.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08, e.clientX, e.clientY); } }, { passive: false });
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) P.addEventListener(ev, (e) => e.preventDefault()); // Safari 페이지 확대 방지
  }
}
