// 공부 기록 화면: 날짜별 공부 시간 달력, 일일 요약, 시간 수동 추가·삭제, 일일 할 일, 자유 공부 타이머
import { dbx, getMeta, setMeta, delRecord } from './db.js';
import { h, uid, toast, fmtTime, fmtDur, ymd, addDays, dayLabel, pad } from './util.js';
import { modal, confirmBox } from './ui.js';
import { SolveTimer, deleteSession } from './timer.js';
import { on, emit } from './events.js';

const $ = (id) => document.getElementById(id);
let cur = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();
let sel = ymd();
let sessions = [], logs = [], todos = [], docTitles = new Map();
export const free = new SolveTimer({ onTick: tick, onChange: () => { tick(free.elapsed(), free.status); renderFree(); } });

const dOf = (s) => s.date || ymd(s.endTs);
const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function tick(sec, st) {
  const big = $('freeBig'); if (big) big.textContent = fmtTime(sec);
  const pill = $('freePill'); if (pill) { pill.hidden = st === 'idle'; pill.textContent = `${st === 'running' ? '● ' : '❚❚ '}공부 ${fmtTime(sec)}`; }
}

async function load() {
  let docs; [sessions, logs, todos, docs] = await Promise.all([dbx.all('sessions'), dbx.all('studylog'), dbx.all('todos'), dbx.all('docs')]);
  docTitles = new Map(docs.map((d) => [d.id, d.title]));
}
export function dayTotals() {
  const m = new Map();
  for (const s of sessions) m.set(dOf(s), (m.get(dOf(s)) || 0) + s.seconds);
  for (const l of logs) m.set(l.date, (m.get(l.date) || 0) + l.seconds);
  return m;
}
const level = (sec) => (sec <= 0 ? 0 : sec < 1800 ? 1 : sec < 3600 ? 2 : sec < 7200 ? 3 : 4);

export function initStudy() {
  const root = $('v-study');
  root.replaceChildren(
    h('h2', { text: '공부 기록' }),
    h('div', { class: 'study-grid' },
      h('div', { class: 'stack' }, h('div', { class: 'card', id: 'freeCard' }), h('div', { class: 'card', id: 'calCard' })),
      h('div', { class: 'card', id: 'dayCard' })));
  free.attach('__free__').then(() => { renderFree(); tick(free.elapsed(), free.status); if (free.status === 'running') free.startLoop(); });
  on('data', () => { if (!root.hidden) show(); });
}

export async function show() { await load(); renderFree(); renderCal(); renderDay(); }

/* ---------- 자유 공부 타이머 ---------- */
function renderFree() {
  const c = $('freeCard'); if (!c) return;
  const st = free.status;
  const note = h('input', { type: 'text', id: 'freeNote', placeholder: '무엇을 공부했나요? (선택)', style: 'flex:1;min-width:140px', value: c.querySelector?.('#freeNote')?.value || '' });
  c.replaceChildren(
    h('h3', { text: '공부 타이머' }),
    h('div', { class: 'big-time', id: 'freeBig', text: fmtTime(free.elapsed()) }),
    h('div', { class: 'sline' },
      h('button', { class: 'btn ' + (st === 'running' ? 'on' : 'primary'), text: st === 'running' ? '일시정지' : st === 'paused' ? '재시작' : '공부 시작', onclick: () => (st === 'running' ? free.pause() : free.start()) }),
      h('button', { class: 'btn', text: '종료·저장', disabled: st === 'idle', onclick: async () => {
        const r = await free.stop({ note: note.value.trim() }); if (r) { toast(`${fmtDur(r.seconds)} 기록했어요`); emit('data'); await show(); } else toast('기록할 시간이 없어요');
      } }),
      h('button', { class: 'btn danger', text: '버리기', disabled: st === 'idle', onclick: async () => { if (await confirmBox('지금까지의 시간을 저장하지 않고 버릴까요?', { ok: '버리기', danger: true })) free.reset(); } })),
    note, h('div', { class: 'muted', style: 'margin-top:6px', text: '시험지를 열고 푸는 시간은 자동으로 이 달력에 합산돼요. 시험지 없이 공부한 시간은 여기서 재거나 “시간 추가”로 넣으세요.' }));
}

/* ---------- 달력 ---------- */
function renderCal() {
  const c = $('calCard'); const totals = dayTotals();
  const first = new Date(cur.y, cur.m, 1), days = new Date(cur.y, cur.m + 1, 0).getDate();
  const today = ymd();
  let monthSec = 0, studied = 0;
  for (let d = 1; d <= days; d++) { const t = totals.get(`${cur.y}-${pad(cur.m + 1)}-${pad(d)}`) || 0; monthSec += t; if (t) studied++; }
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(h('div', { class: 'cal-c blank' }));
  const todoDates = new Set(todos.map((t) => t.date));
  for (let d = 1; d <= days; d++) {
    const key = `${cur.y}-${pad(cur.m + 1)}-${pad(d)}`; const t = totals.get(key) || 0;
    cells.push(h('button', { class: `cal-c l${level(t)}${key === sel ? ' sel' : ''}${key === today ? ' today' : ''}`, 'aria-label': `${d}일 ${fmtDur(t)}`, onclick: () => { sel = key; renderCal(); renderDay(); } },
      h('span', { class: 'cd', text: d }), t ? h('span', { class: 'ct', text: t >= 3600 ? `${Math.floor(t / 3600)}h${pad(Math.floor(t % 3600 / 60))}` : `${Math.max(1, Math.round(t / 60))}분` }) : null, todoDates.has(key) ? h('i', { class: 'dot' }) : null));
  }
  const nav = (n) => { const d = new Date(cur.y, cur.m + n, 1); cur = { y: d.getFullYear(), m: d.getMonth() }; renderCal(); };
  c.replaceChildren(
    h('div', { class: 'row' }, h('button', { class: 'btn sm', text: '◀', 'aria-label': '이전 달', onclick: () => nav(-1) }), h('b', { text: `${cur.y}년 ${cur.m + 1}월` }), h('button', { class: 'btn sm', text: '▶', 'aria-label': '다음 달', onclick: () => nav(1) }), h('button', { class: 'btn sm', text: '오늘', onclick: () => { const d = new Date(); cur = { y: d.getFullYear(), m: d.getMonth() }; sel = ymd(); renderCal(); renderDay(); } }), h('span', { class: 'sp' }), h('span', { class: 'muted', text: `이번 달 ${fmtDur(monthSec)} · ${studied}일` })),
    h('div', { class: 'cal' }, ['일', '월', '화', '수', '목', '금', '토'].map((x) => h('div', { class: 'cal-h', text: x })), cells),
    h('div', { class: 'muted', style: 'margin-top:6px', text: '진한 칸일수록 오래 공부한 날 · 점(•)은 할 일이 있는 날' }));
}

/* ---------- 하루 상세 ---------- */
function entriesOf(date) {
  const a = sessions.filter((s) => dOf(s) === date).map((s) => ({ kind: 'session', id: s.id, rec: s, label: s.title || docTitles.get(s.docId) || '풀이', note: s.note || '', sec: s.seconds, at: s.endTs, range: s.startTs ? `${hm(s.startTs)}–${hm(s.endTs)}` : hm(s.endTs) }));
  const b = logs.filter((l) => l.date === date).map((l) => ({ kind: 'manual', id: l.id, rec: l, label: l.note || '직접 추가한 공부', note: '', sec: l.seconds, at: l.createdAt || 0, range: '수동' }));
  return [...a, ...b].sort((x, y) => x.at - y.at);
}
export function dayTotal(date) { return entriesOf(date).reduce((a, e) => a + e.sec, 0); }

function renderDay() {
  const c = $('dayCard'); const es = entriesOf(sel); const total = es.reduce((a, e) => a + e.sec, 0);
  const ts = todos.filter((t) => t.date === sel).sort((a, b) => (a.order || 0) - (b.order || 0));
  const inp = h('input', { type: 'text', placeholder: '할 일 추가', style: 'flex:1;min-width:0', onkeydown: (e) => { if (e.key === 'Enter') add(); } });
  const add = async () => { const t = inp.value.trim(); if (!t) return; await dbx.put('todos', { id: uid(), date: sel, text: t, done: false, order: Date.now(), updatedAt: Date.now() }); await show(); };
  c.replaceChildren(
    h('div', { class: 'row' }, h('h2', { style: 'margin:0', text: dayLabel(sel) + (sel === ymd() ? ' · 오늘' : '') }), h('span', { class: 'sp' }), h('button', { class: 'btn sm', text: '하루 요약', onclick: () => summaryModal(sel) })),
    h('div', { class: 'big-time', text: fmtDur(total) || '0초' }),
    h('div', { class: 'row' }, h('button', { class: 'btn sm primary', text: '+ 공부 시간 추가', onclick: () => manualModal() })),
    h('h3', { style: 'margin-top:14px', text: '공부 기록' }),
    es.length ? h('div', { class: 'plist' }, es.map((e) => h('div', { class: 'entry' },
      h('div', { style: 'min-width:0;flex:1' }, h('div', { text: e.label, style: 'font-weight:600;overflow:hidden;text-overflow:ellipsis' }), h('div', { class: 'muted', text: [e.range, e.note].filter(Boolean).join(' · ') })),
      h('b', { text: fmtDur(e.sec) }),
      h('button', { class: 'btn sm danger', text: '삭제', 'aria-label': '이 기록 삭제', onclick: async () => {
        if (!(await confirmBox(`“${e.label}” ${fmtDur(e.sec)} 기록을 삭제할까요?\n(잘못 기록된 시간을 지우는 용도예요. 되돌릴 수 없어요)`, { ok: '삭제', danger: true }))) return;
        if (e.kind === 'session') await deleteSession(e.rec); else await delRecord('studylog', e.id);
        toast('삭제했어요'); emit('data'); await show();
      } })))) : h('div', { class: 'muted', text: '이 날의 기록이 없어요' }),
    h('h3', { style: 'margin-top:16px', text: `할 일 (${ts.filter((t) => t.done).length}/${ts.length})` }),
    h('div', { class: 'plist' }, ts.map((t) => h('div', { class: 'entry' },
      h('input', { type: 'checkbox', checked: t.done, 'aria-label': '완료', style: 'width:22px;height:22px', onchange: async (e) => { t.done = e.target.checked; t.updatedAt = Date.now(); await dbx.put('todos', t); await show(); } }),
      h('span', { style: 'flex:1;min-width:0;' + (t.done ? 'text-decoration:line-through;color:var(--mute)' : ''), text: t.text }),
      h('button', { class: 'btn sm ghost', text: '✕', 'aria-label': '할 일 삭제', onclick: async () => { await delRecord('todos', t.id); await show(); } })))),
    h('div', { class: 'sline' }, inp, h('button', { class: 'btn sm primary', text: '추가', onclick: add })),
    ts.some((t) => !t.done) ? h('button', { class: 'btn sm', text: '안 한 일 내일로 넘기기', onclick: async () => {
      const next = addDays(sel, 1); const left = ts.filter((t) => !t.done);
      for (const t of left) { await dbx.put('todos', { ...t, date: next, updatedAt: Date.now() }); }
      toast(`${left.length}개를 ${dayLabel(next)}로 넘겼어요`); await show();
    } }) : null);
}

/* ---------- 시간 수동 추가 ---------- */
function manualModal() {
  const date = h('input', { type: 'date', value: sel, max: ymd() });
  const hh = h('input', { type: 'number', min: 0, max: 24, value: 0, inputmode: 'numeric', style: 'width:80px' });
  const mm = h('input', { type: 'number', min: 0, max: 59, value: 30, inputmode: 'numeric', style: 'width:80px' });
  const note = h('input', { type: 'text', placeholder: '예: 문학 기출 복습 (선택)', style: 'width:100%' });
  const f = (l, ...el) => h('div', { class: 'field' }, h('label', { text: l }), h('div', { class: 'row' }, ...el));
  modal({
    title: '공부 시간 직접 추가', body: h('div', {}, f('날짜', date), f('공부한 시간', hh, '시간', mm, '분'), f('내용', note)),
    actions: [{ label: '취소' }, { label: '추가', primary: true, onClick: async () => {
      const sec = (+hh.value || 0) * 3600 + (+mm.value || 0) * 60;
      if (!date.value || sec <= 0 || sec > 86400) { toast('날짜와 시간(1분~24시간)을 확인하세요', 'error'); return false; }
      if (date.value > ymd()) { toast('미래 날짜에는 추가할 수 없어요', 'error'); return false; }
      const now = Date.now();
      await dbx.put('studylog', { id: uid(), date: date.value, seconds: sec, note: note.value.trim(), createdAt: now, updatedAt: now });
      sel = date.value; const [y, m] = sel.split('-').map(Number); cur = { y, m: m - 1 };
      toast(`${fmtDur(sec)} 추가했어요`); emit('data'); await show();
    } }],
  });
}

/* ---------- 일일 요약 ---------- */
export async function summaryModal(date) {
  await load();
  const es = entriesOf(date); const total = es.reduce((a, e) => a + e.sec, 0);
  const ts = todos.filter((t) => t.date === date);
  const prev = dayTotal(addDays(date, -1));
  const by = new Map(); es.forEach((e) => by.set(e.label, (by.get(e.label) || 0) + e.sec));
  const diff = total - prev;
  modal({
    title: `${dayLabel(date)} 공부 요약`,
    body: h('div', { class: 'stack' },
      h('div', { class: 'big-time', text: fmtDur(total) || '기록 없음' }),
      h('div', { class: 'muted', text: prev ? `전날보다 ${diff >= 0 ? '+' : '−'}${fmtDur(Math.abs(diff))}` : '전날 기록 없음' }),
      by.size ? h('div', {}, [...by].sort((a, b) => b[1] - a[1]).map(([k, v]) => h('div', { class: 'row' }, h('span', { style: 'flex:1', text: k }), h('b', { text: fmtDur(v) })))) : null,
      h('div', { text: ts.length ? `할 일 ${ts.filter((t) => t.done).length}/${ts.length} 완료` : '등록된 할 일 없음' }),
      ts.filter((t) => !t.done).length ? h('div', { class: 'muted', text: '못 한 일: ' + ts.filter((t) => !t.done).map((t) => t.text).join(', ') }) : null),
    actions: [{ label: '닫기', primary: true }],
  });
}

/** 하루가 지난 뒤 처음 열면 어제 요약을 한 번 보여 준다 */
export async function maybeShowYesterday() {
  await load();
  const y = addDays(ymd(), -1);
  if ((await getMeta('summaryShown', '')) === y) return;
  const has = dayTotal(y) > 0 || todos.some((t) => t.date === y);
  await setMeta('summaryShown', y);
  if (has) await summaryModal(y);
}
