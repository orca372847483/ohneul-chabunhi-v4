// 손글씨 메모장: 시험지 쪽에 연동(기본) 또는 자유 노트. 시험지 필기와 같은 엔진, 자료별·쪽별 자동 저장.
import { InkLayer } from './ink.js';
import { h } from './util.js';
import { memoTool, persistTools, COLORS } from './tools.js';
import { dbx, saveDoc } from './db.js';

export class MemoPad {
  constructor({ store }) {
    this.store = store; this.doc = null; this.linked = true; this.note = 1; this.page = 1; this.layer = null; this.root = null;
  }
  noteLabel(n) { return this.doc?.noteLabels?.[`n${n}`] || ''; }
  key() { return this.linked ? `${this.doc.id}|p${this.page}` : `${this.doc.id}|n${this.note}`; }
  setContext(doc, page) {
    const changed = !this.doc || this.doc.id !== doc.id || (this.linked && this.page !== page);
    this.doc = doc; this.page = page;
    if (changed && this.root) this.load();
  }
  async notes() { // 이 자료의 자유 노트 번호들
    const recs = await dbx.byIndex('memos', 'docId', this.doc.id);
    const ns = recs.map((r) => /\|n(\d+)$/.exec(r.key)?.[1]).filter(Boolean).map(Number);
    return [...new Set([1, ...ns])].sort((a, b) => a - b);
  }

  mount(root) {
    this.root = root; root.replaceChildren();
    const mk = (txt, fn, cls = '') => h('button', { class: 'btn sm ' + cls, text: txt, onclick: fn });
    this.bPen = mk('펜', () => this.setTool('pen'), 'on'); this.bEr = mk('지우개', () => this.setTool('eraser'));
    this.sw = h('span', { style: 'display:inline-flex;gap:5px;align-items:center' }, COLORS.slice(0, 3).map((c) => h('button', { class: 'swatch' + (c === memoTool.color ? ' on' : ''), style: `background:${c}`, 'aria-label': '메모 색 ' + c, onclick: (e) => { memoTool.color = c; memoTool.tool = 'pen'; this.setTool('pen'); [...this.sw.children].forEach((x) => x.classList.toggle('on', x === e.currentTarget)); persistTools(); } })));
    this.rw = h('input', { type: 'range', min: 1, max: 12, value: memoTool.width, 'aria-label': '메모 굵기', style: 'width:70px', oninput: () => { memoTool.width = +this.rw.value; persistTools(); } });
    this.modeSeg = h('div', { class: 'seg' }, [h('button', { class: 'on', text: '쪽 연동', onclick: () => this.setLinked(true) }), h('button', { text: '자유 노트', onclick: () => this.setLinked(false) })]);
    this.noteBar = h('div', { class: 'sline', hidden: true });
    this.wrap = h('div', { class: 'memo-wrap' });
    this.base = h('canvas'); this.live = h('canvas'); this.wrap.append(this.base, this.live);
    this.info = h('div', { class: 'muted' });
    root.append(
      h('div', { class: 'sline' }, this.modeSeg, h('span', { class: 'sp' })),
      this.noteBar,
      h('div', { class: 'sline' }, this.bPen, this.bEr, this.sw, this.rw),
      this.wrap,
      h('div', { class: 'sline' }, mk('실행 취소', () => this.act('undo')), mk('다시', () => this.act('redo')), mk('이 메모 지우기', () => this.act('clear'), 'danger')),
      this.info,
    );
    this.ro = new ResizeObserver(() => this.fitCanvas()); this.ro.observe(this.wrap);
    this.load();
  }
  unmount() { this.layer?.destroy(); this.layer = null; this.ro?.disconnect(); this.root = null; }

  setTool(t) { memoTool.tool = t; this.bPen.classList.toggle('on', t === 'pen'); this.bEr.classList.toggle('on', t === 'eraser'); }
  setLinked(v) {
    this.linked = v;
    [...this.modeSeg.children].forEach((b, i) => b.classList.toggle('on', (i === 0) === v));
    this.load();
  }
  async buildNoteBar() {
    this.noteBar.hidden = this.linked;
    if (this.linked) return;
    const ns = await this.notes();
    this.noteBar.replaceChildren(...ns.map((n) => h('button', { class: 'chip' + (n === this.note ? ' on' : ''), text: this.noteLabel(n) || `노트 ${n}`, onclick: () => { this.note = n; this.load(); } })),
      h('button', { class: 'chip', text: '+ 새 노트', onclick: () => { this.note = Math.max(...ns) + 1; this.load(); } }));
  }
  async load() {
    if (!this.doc || !this.root) return;
    await this.buildNoteBar();
    const k = this.key();
    const entry = await this.store.open(k, this.doc.id, this.linked ? this.page : `n${this.note}`);
    this.layer?.destroy();
    this.layer = new InkLayer({ base: this.base, live: this.live, store: this.store, entry, tools: () => memoTool });
    this.fitCanvas();
    this.info.textContent = this.linked ? `시험지 ${this.page}쪽에 연결된 메모예요. 쪽을 넘기면 그 쪽의 메모가 열려요` : `자유 노트 ${this.note} · 시험지 쪽과 상관없이 유지돼요`;
  }
  fitCanvas() {
    if (!this.layer || !this.wrap) return;
    const r = this.wrap.getBoundingClientRect();
    if (r.width < 10) return;
    this.layer.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 2));
  }
  act(a) {
    const e = this.layer?.entry; if (!e) return;
    if (a === 'undo') this.store.undo(e); else if (a === 'redo') this.store.redo(e); else this.store.clear(e);
  }
}

/** v3 에서 가져온 메모의 이름표를 저장 */
export async function setNoteLabel(doc, n, label) {
  doc.noteLabels = { ...(doc.noteLabels || {}), [`n${n}`]: label };
  await saveDoc(doc);
}
