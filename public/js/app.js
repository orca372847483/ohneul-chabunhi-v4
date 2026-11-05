// 앱 진입점: 부팅, 라우팅, 시험지 화면 제어, 설정
import { openDB, dbx, saveDoc, getMeta, setMeta, requestPersistence, storageEstimate, delRecord } from './db.js';
import { lsGet, lsSet, h, uid, toast, fmtTime, fmtDur, fmtDate, debounce } from './util.js';
import { ensureText, searchPages } from './search.js';
import { initStudy, show as showStudy, maybeShowYesterday } from './study.js';
import { InkStore } from './ink.js';
import { Reader } from './viewer.js';
import { MemoPad } from './memo.js';
import { SolveTimer, deleteSession } from './timer.js';
import { paperTool, COLORS, INPUTS, persistTools } from './tools.js';
import { getDoc, getBuffer } from './docs.js';
import { initLibrary, refresh as refreshLibrary } from './library.js';
import { initCollect, onShowCollect, checkHealth } from './collect.js';
import { editPassage, addPassage, tagChips, confText, qRange, pageRange } from './passages.js';
import { runAnalyze } from './actions.js';
import { initSync, onSyncState, syncPanel, syncNow, scheduleSync } from './sync-client.js';
import { migrateV3 } from './migrate-v3.js';
import { modal, confirmBox } from './ui.js';
import { on } from './events.js';

const $ = (id) => document.getElementById(id);
const VERSION = '4.0.0';

/* ---------- 오류를 사용자에게 보여 주기 ---------- */
function fatal(title, err, hint) {
  document.querySelector('main').replaceChildren(h('div', { class: 'card fatal stack' }, h('h2', { text: title }), h('div', { text: err?.message || String(err) }), hint ? h('div', { class: 'muted', text: hint }) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', text: '새로고침', onclick: () => location.reload() }))));
}
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast(`오류: ${e.reason?.message || e.reason}`, 'error', 7000); });
window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver/.test(e.message)) toast(`오류: ${e.message}`, 'error', 7000); });

/* ---------- 저장 상태 표시 ---------- */
function showSave(state, msg) {
  const map = { dirty: ['busy', '저장 중…'], saving: ['busy', '저장 중…'], saved: ['ok', '저장됨'], error: ['err', msg || '저장 실패'] };
  const [cls, text] = map[state] || ['', '저장 대기'];
  for (const id of ['saveState', 'rSave']) { const el = $(id); el.className = 'pill ' + cls; el.textContent = text; el.title = msg || ''; }
  if (state === 'error') toast(msg, 'error', 8000);
  if (state === 'saved') scheduleSync();
}
const inkStore = new InkStore('ink', { onState: showSave });
const memoStore = new InkStore('memos', { onState: showSave });
const flushAll = () => Promise.all([inkStore.flush(), memoStore.flush()]);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushAll(); timer.s?.status === 'running' && timer.persist(); } });
window.addEventListener('pagehide', () => { flushAll(); });
on('doc-deleted', (id) => { inkStore.forgetAll(); memoStore.forgetAll(); void id; });

/* ---------- 라우터 ---------- */
let current = null; // 현재 열린 자료
const views = { lib: $('v-lib'), collect: $('v-collect'), study: $('v-study'), read: $('v-reader') };
async function route() {
  const [, seg = 'lib', id, pg] = (location.hash || '#/lib').split('/');
  if (current && seg !== 'read') await leaveReader();
  for (const [k, el] of Object.entries(views)) el.hidden = k !== seg;
  document.body.classList.toggle('reading', seg === 'read');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === seg));
  if (seg === 'lib') refreshLibrary();
  else if (seg === 'collect') onShowCollect();
  else if (seg === 'study') showStudy();
  else if (seg === 'read') await openReader(id, pg ? +pg : null);
  else location.replace('#/lib');
}
window.addEventListener('hashchange', route);
const goOpen = (id, page) => { location.hash = `#/read/${id}${page ? '/' + page : ''}`; };

/* ---------- 시험지 화면 ---------- */
const reader = new Reader({ paper: $('paper'), spread: $('spread'), store: inkStore, tools: () => paperTool, onChange: onReaderChange });
reader.onError = (e) => toast(`시험지를 그리지 못했어요: ${e?.message || e}`, 'error', 7000);
const memo = new MemoPad({ store: memoStore });
const timer = new SolveTimer({ onTick: onTick, onChange: () => { renderTimerBtns(); if (tab === 'solve') renderSolveTab(); } });
let tab = 'memo', texts = null, passList = [];
const analyzedTexts = (r) => (r && r.mode !== 'search-only' ? r : null);
const saveLast = debounce(async (id, page) => { const d = await getDoc(id); if (d && d.lastPage !== page) { d.lastPage = page; await saveDoc(d); } }, 1500);

function onTick(sec, status) {
  $('tmTime').textContent = fmtTime(sec);
  const big = document.getElementById('bigTime'); if (big) big.textContent = fmtTime(sec);
  void status;
}
function renderTimerBtns() {
  const st = timer.status;
  $('tmBtn').textContent = st === 'running' ? '일시정지' : st === 'paused' ? '재시작' : '시작';
  $('tmBtn').classList.toggle('on', st === 'running');
  $('tmStop').hidden = st === 'idle';
}
$('tmBtn').onclick = () => (timer.status === 'running' ? timer.pause() : timer.start());
$('tmStop').onclick = () => finishSolve();
async function finishSolve() {
  if (!(await confirmBox(`풀이를 종료하고 ${fmtDur(timer.elapsed())} 기록을 저장할까요?`, { ok: '종료·저장' }))) return;
  const rec = await timer.stop();
  toast(rec ? `풀이 시간 ${fmtDur(rec.seconds)} 저장했어요` : '기록할 시간이 없어 저장하지 않았어요');
  current = await getDoc(current.id);
  if (tab === 'solve') renderSolveTab();
}

async function openReader(id, page) {
  const msg = $('rMsg'); msg.hidden = false; msg.replaceChildren(h('div', { class: 'muted', text: '시험지를 불러오는 중…' }));
  try {
    const doc = await getDoc(id);
    if (!doc) { msg.hidden = true; toast('자료를 찾을 수 없어요', 'error'); location.replace('#/lib'); return; }
    if (!doc.hasFile) { msg.hidden = true; toast('이 기기에 PDF가 없어요. 자료함에서 PDF를 연결하세요', 'error'); location.replace('#/lib'); return; }
    if (current?.id === id && reader.pdf) { if (page) reader.goto(page); return; }
    if (current) await leaveReader();
    const buf = await getBuffer(id);
    if (!buf) throw new Error('저장된 PDF 데이터를 읽지 못했어요(저장소가 비워졌을 수 있어요)');
    current = doc;
    $('rTitle').textContent = doc.title;
    doc.openedAt = Date.now(); await saveDoc(doc, { silent: false });
    await timer.attach(id);
    texts = analyzedTexts(await dbx.get('texts', id));
    passList = (await dbx.byIndex('passages', 'docId', id)).sort((a, b) => a.pageFrom - b.pageFrom || (a.qFrom || 0) - (b.qFrom || 0));
    if (!applyPanelOnce) { applyPanelOnce = true; setPanel(lsPanel()); }
    await reader.open(doc, buf, page || lsGet('lp-' + id, 0) || doc.lastPage || 1);
    msg.hidden = true;
    renderTimerBtns(); onTick(timer.elapsed(), timer.status);
    if (timer.s?.recovered) toast('앱이 닫혔던 풀이를 일시정지 상태로 복구했어요. 마지막으로 확인된 시간까지만 반영돼요');
  } catch (e) {
    console.error(e);
    msg.hidden = false; msg.replaceChildren(h('div', { class: 'card stack' }, h('b', { text: '시험지를 열 수 없어요' }), h('div', { text: e.message }), h('button', { class: 'btn primary', text: '자료함으로', onclick: () => { location.hash = '#/lib'; } })));
    current = null;
  }
}
let applyPanelOnce = false;
async function leaveReader() {
  const id = current?.id; current = null;
  await timer.leave(); await flushAll();
  memo.unmount(); reader.close();
  if (id && timer.s?.status === 'paused' && timer.elapsed() > 0) toast('풀이를 일시정지했어요. 다시 열면 이어서 할 수 있어요', 'info', 3500);
}

function onReaderChange(s) {
  $('rPage').value = s.page; $('rPage').max = s.total; $('rTotal').textContent = `/ ${s.total}`;
  $('zLabel').textContent = Math.round(s.z * 100) + '%';
  $('rMode').textContent = { auto: s.count === 2 ? '자동·2쪽' : '자동·1쪽', 1: '1쪽', 2: '2쪽' }[s.mode];
  $('rPrev').disabled = s.page <= 1; $('rNext').disabled = s.pages[s.pages.length - 1] >= s.total;
  if (current) { memo.setContext(current, s.page); saveLast(current.id, s.page); lsSet('lp-' + current.id, s.page); if (tab === 'pass') renderPassTab(); }
  updateQHint(); refreshBm();
}

/* 툴바 */
const go = () => reader.goto($('rPage').value);
$('rPage').onchange = go; $('rPage').onkeydown = (e) => { if (e.key === 'Enter') { go(); e.target.blur(); } };
$('rPrev').onclick = () => reader.prev(); $('rNext').onclick = () => reader.next();
$('zIn').onclick = () => reader.zoomBy(1.2); $('zOut').onclick = () => reader.zoomBy(1 / 1.2); $('zFit').onclick = () => reader.fitScreen();
$('rMode').onclick = () => reader.setMode({ auto: '1', 1: '2', 2: 'auto' }[reader.pref]);
$('rBack').onclick = () => { location.hash = '#/lib'; };
function setTool(t) { paperTool.tool = t; $('tPen').classList.toggle('on', t === 'pen'); $('tHi').classList.toggle('on', t === 'highlighter'); $('tEr').classList.toggle('on', t === 'eraser'); }
$('tPen').onclick = () => setTool('pen'); $('tHi').onclick = () => setTool('highlighter'); $('tEr').onclick = () => setTool('eraser');
const sw = $('colors');
COLORS.forEach((c) => sw.append(h('button', { class: 'swatch' + (c === paperTool.color ? ' on' : ''), style: `background:${c}`, 'aria-label': '색상 ' + c, onclick: (e) => { paperTool.color = c; if (paperTool.tool === 'eraser') setTool('pen'); [...sw.children].forEach((x) => x.classList.toggle('on', x === e.currentTarget)); persistTools(); } })));
$('tW').value = paperTool.width; $('tW').oninput = () => { paperTool.width = +$('tW').value; persistTools(); };
$('tUndo').onclick = () => reader.undo(); $('tRedo').onclick = () => reader.redo();
function renderInput() { const i = INPUTS.find((x) => x.id === paperTool.input) || INPUTS[0]; $('tInput').textContent = i.label; $('tInput').title = i.hint; $('tInput').classList.toggle('on', paperTool.input === 'all'); }
$('tInput').onclick = () => { const i = INPUTS.findIndex((x) => x.id === paperTool.input); paperTool.input = INPUTS[(i + 1) % INPUTS.length].id; persistTools(); renderInput(); toast(INPUTS.find((x) => x.id === paperTool.input).hint, 'info', 2600); };
renderInput();
$('tMore').onclick = () => {
  const m = modal({
    title: '필기 지우기',
    body: h('div', { class: 'stack' },
      h('div', { class: 'muted', text: '필기는 시험지 위의 별도 레이어라서 PDF 원본은 바뀌지 않아요. 지운 뒤에는 ‘실행 취소’로 되돌릴 수 있어요(이 화면을 벗어나기 전까지).' }),
      h('button', { class: 'btn', style: 'width:100%', text: '방금 필기한 면 지우기', onclick: () => { reader.clearActive() ? toast('이 면의 필기를 지웠어요') : toast('지울 필기가 없어요'); m.close(); } }),
      h('button', { class: 'btn', style: 'width:100%', text: '지금 보이는 면 모두 지우기', onclick: () => { let n = 0; reader.boxes.forEach((b) => { if (inkStore.clear(b.entry)) n++; }); toast(n ? `${n}개 면의 필기를 지웠어요` : '지울 필기가 없어요'); m.close(); } }),
      h('button', { class: 'btn danger', style: 'width:100%', text: '이 자료의 필기 전체 삭제…', onclick: async () => { m.close(); await clearAllInk(); } })),
    actions: [{ label: '닫기' }],
  });
};
async function clearAllInk() {
  if (!current) return;
  if (!(await confirmBox('이 자료의 모든 쪽 필기를 삭제할까요?\n(시험지 필기만 해당하고 메모와 PDF는 그대로예요. 되돌릴 수 없어요)', { ok: '전체 삭제', danger: true }))) return;
  await flushAll();
  const recs = await dbx.byIndex('ink', 'docId', current.id);
  const now = Date.now(); // 삭제 기록을 동기화로 전파하려고 빈 필기로 덮어쓴다
  await dbx.putMany('ink', recs.map((r) => ({ ...r, strokes: [], updatedAt: now })));
  inkStore.forget(current.id); await reader.render(); scheduleSync(); toast('필기를 모두 삭제했어요');
}

/* 키보드(아이패드 키보드·PC) */
document.addEventListener('keydown', (e) => {
  if (views.read.hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? reader.redo() : reader.undo(); }
  else if (e.key === 'ArrowRight') reader.next(); else if (e.key === 'ArrowLeft') reader.prev();
  else if (e.key === '+' || e.key === '=') reader.zoomBy(1.2); else if (e.key === '-') reader.zoomBy(1 / 1.2);
});

/* 문제 번호로 이동 (v3 의 ‘문제 바로가기’: 분석된 시험지는 실제로 이동한다) */
function questionPage(n) { return texts?.questionPages?.[n] || null; }
function updateQHint() { const n = +$('qNum').value; $('qHint').textContent = !texts ? '분석 필요' : n ? (questionPage(n) ? `${questionPage(n)}쪽` : '찾지 못함') : ''; }
$('qNum').oninput = updateQHint;
$('qGo').onclick = () => {
  const n = +$('qNum').value; if (!n) return;
  if (!texts) return toast('먼저 ‘지문’ 탭에서 이 자료를 분석하면 문제 번호로 이동할 수 있어요');
  const p = questionPage(n);
  if (p) reader.goto(p); else toast(`${n}번 문항 위치를 찾지 못했어요. 쪽 번호로 이동해 주세요`, 'error');
};
$('qNum').onkeydown = (e) => { if (e.key === 'Enter') $('qGo').click(); };

/* ---------- 오른쪽 패널(메모 · 지문 · 풀이) ---------- */
const lsPanel = () => { try { return JSON.parse(localStorage.getItem('panel-v4') || '{}'); } catch { return {}; } };
function setPanel(o) {
  const p = $('panel'); const cur = { open: !p.hidden, wide: p.classList.contains('wide'), tab, ...o };
  p.hidden = !cur.open; p.classList.toggle('wide', !!cur.wide); tab = cur.tab || 'memo';
  try { localStorage.setItem('panel-v4', JSON.stringify(cur)); } catch { /* ignore */ }
  $('rPanelBtn').classList.toggle('on', cur.open);
  if (cur.open) renderTab(); else memo.unmount();
  setTimeout(() => reader.pdf && reader._onResize(), 60);
}
$('rPanelBtn').onclick = () => setPanel({ open: $('panel').hidden });
$('pClose').onclick = () => setPanel({ open: false });
$('pWide').onclick = () => setPanel({ wide: !$('panel').classList.contains('wide') });
$('ptabs').querySelectorAll('button').forEach((b) => { b.onclick = () => setPanel({ tab: b.dataset.t }); });
function renderTab() {
  $('ptabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  if (tab !== 'memo') memo.unmount();
  if (tab === 'memo') { memo.mount($('pbody')); if (current) memo.setContext(current, reader.pages[0] || 1); }
  else if (tab === 'pass') renderPassTab(); else if (tab === 'search') renderSearchTab(); else if (tab === 'mark') renderMarkTab(); else renderSolveTab();
}

async function reloadPass() { if (!current) return; passList = (await dbx.byIndex('passages', 'docId', current.id)).sort((a, b) => a.pageFrom - b.pageFrom || (a.qFrom || 0) - (b.qFrom || 0)); current = await getDoc(current.id); texts = analyzedTexts(await dbx.get('texts', current.id)); }
function renderPassTab() {
  const b = $('pbody'); const cur = reader.pages;
  const a = current?.analysis;
  const head = h('div', { class: 'stack' },
    h('div', { class: 'muted', text: a ? `분석 ${fmtDate(a.at)} · 지문 ${a.passages}개 (자동 ${a.auto} · 수동 필요 ${a.needsManual})${a.mode === 'page-fallback' ? ' · 쪽 단위 추정' : ''}` : '아직 분석하지 않은 자료예요' }),
    ...(a?.note || []).map((n) => h('div', { class: 'notice', text: n })),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm primary', text: a ? '다시 분석' : '분석하기', onclick: async () => { await runAnalyze(current.id); await reloadPass(); renderPassTab(); } }),
      h('button', { class: 'btn sm', text: '+ 지문 직접 추가', onclick: () => addPassage(current, async () => { await reloadPass(); renderPassTab(); }) })));
  const list = h('div', { style: 'margin-top:10px' }, passList.length ? passList.map((p) => h('div', { class: 'pi' + (cur.some((n) => n >= p.pageFrom && n <= p.pageTo) ? ' cur' : ''), onclick: () => reader.goto(p.pageFrom) },
    h('div', { class: 'row' }, h('b', { text: qRange(p) }), h('span', { class: 'muted', text: pageRange(p) }), h('span', { class: 'sp' }), h('button', { class: 'btn sm', text: '근거·수정', onclick: (e) => { e.stopPropagation(); editPassage(p, async () => { await reloadPass(); renderPassTab(); }); } })),
    h('div', { class: 'pv', text: p.heading || p.preview || '' }),
    h('div', { class: 'chips' }, tagChips(p), h('span', { class: 'muted', text: confText(p) })))) : h('div', { class: 'empty', text: '분류된 지문이 없어요' }));
  b.replaceChildren(head, list);
}

function renderSolveTab() {
  const b = $('pbody'); if (!current) return;
  const st = timer.status;
  const q = h('input', { type: 'number', min: 1, max: 45, placeholder: '문항', style: 'width:70px', inputmode: 'numeric', id: 'lapQ' });
  const mk = h('select', { id: 'lapM' }, ['', 'O', 'X', '△'].map((v) => h('option', { value: v, text: v || '표시 없음' })));
  const logs = timer.s?.qlogs || [];
  b.replaceChildren(
    h('div', { class: 'big-time', id: 'bigTime', text: fmtTime(timer.elapsed()) }),
    h('div', { class: 'sline' },
      h('button', { class: 'btn' + (st === 'running' ? ' on' : ' primary'), text: st === 'running' ? '일시정지' : st === 'paused' ? '재시작' : '풀이 시작', onclick: () => $('tmBtn').click() }),
      h('button', { class: 'btn', text: '풀이 종료', disabled: st === 'idle', onclick: () => finishSolve() }),
      h('button', { class: 'btn danger', text: '초기화', disabled: st === 'idle', onclick: async () => { if (await confirmBox('이번 풀이 기록(저장 전)을 버릴까요?', { ok: '버리기', danger: true })) timer.reset(); } })),
    h('h3', { style: 'margin-top:14px', text: '문항별 기록' }),
    h('div', { class: 'sline' }, q, mk, h('button', { class: 'btn sm', text: '이 문항 풀이 완료', onclick: async () => { try { await timer.lap(q.value, mk.value); q.value = +q.value ? +q.value + 1 : ''; } catch (e) { toast(e.message, 'error'); } } })),
    h('div', { class: 'muted', text: '문항을 끝낼 때마다 누르면 직전 기록 이후 걸린 시간이 그 문항에 기록돼요.' }),
    logs.length ? h('table', { class: 'log' }, h('tr', {}, ['문항', '걸린 시간', '표시', ''].map((x) => h('th', { text: x }))), logs.map((l, i) => h('tr', {}, h('td', { text: l.q ? l.q + '번' : '-' }), h('td', { text: fmtDur(l.sec) }), h('td', { text: l.mark || '' }), h('td', {}, h('button', { class: 'btn sm ghost', text: '✕', onclick: () => timer.removeLap(i) }))))) : null,
    h('h3', { style: 'margin-top:14px', text: '이 자료의 풀이 기록' }),
    h('div', { id: 'sessList', class: 'muted', text: '불러오는 중…' }));
  dbx.byIndex('sessions', 'docId', current.id).then((ss) => {
    const el = document.getElementById('sessList'); if (!el) return;
    ss.sort((x, y) => y.endTs - x.endTs);
    el.replaceChildren(h('div', { text: `총 ${fmtDur(current.solveSec || 0)} · ${current.solveCount || 0}회` }),
      ss.length ? h('table', { class: 'log' }, ss.map((s) => h('tr', {}, h('td', { text: fmtDate(s.endTs) }), h('td', { text: fmtDur(s.seconds) }), h('td', { text: s.qlogs?.length ? `문항 ${s.qlogs.length}개 기록` : '' }), h('td', {}, h('button', { class: 'btn sm ghost', text: '삭제', onclick: async () => { await deleteSession(s); current = await getDoc(current.id); renderSolveTab(); } }))))) : h('div', { text: '아직 기록이 없어요' }));
  });
}


/* ---------- 책갈피 ---------- */
let bms = [];
async function loadBms() { bms = current ? (await dbx.byIndex('bookmarks', 'docId', current.id)).sort((a, b) => a.page - b.page) : []; }
async function refreshBm() {
  if (!current) return; await loadBms();
  const on = reader.pages.some((n) => bms.some((b) => b.page === n));
  $('bmBtn').textContent = (on ? '★' : '☆') + ' 책갈피'; $('bmBtn').classList.toggle('on', on);
  if (tab === 'mark' && !$('panel').hidden) renderMarkTab(true);
}
$('bmBtn').onclick = async () => {
  if (!current) return;
  const page = reader.pages[0]; const ex = bms.find((b) => reader.pages.includes(b.page));
  if (ex) { await delRecord('bookmarks', ex.id); toast(`${ex.page}쪽 책갈피를 뺐어요`); }
  else { const now = Date.now(); await dbx.put('bookmarks', { id: uid(), docId: current.id, page, label: '', createdAt: now, updatedAt: now }); toast(`${page}쪽에 책갈피를 꽂았어요`); scheduleSync(); }
  refreshBm();
};
async function renderMarkTab(fromRefresh) {
  if (!fromRefresh) await loadBms();
  const b = $('pbody');
  b.replaceChildren(
    h('div', { class: 'sline' }, h('button', { class: 'btn sm primary', text: `+ ${reader.pages[0]}쪽에 책갈피`, onclick: async () => { if (!bms.some((x) => x.page === reader.pages[0])) { const now = Date.now(); await dbx.put('bookmarks', { id: uid(), docId: current.id, page: reader.pages[0], label: '', createdAt: now, updatedAt: now }); } refreshBm(); } })),
    bms.length ? bms.map((m) => h('div', { class: 'entry', style: 'margin-bottom:6px' },
      h('button', { class: 'btn sm', text: `${m.page}쪽`, onclick: () => reader.goto(m.page) }),
      h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis', text: m.label || '(이름 없음)' }),
      h('button', { class: 'btn sm ghost', text: '이름', onclick: () => { const i = h('input', { type: 'text', value: m.label, placeholder: '예: 헷갈린 문제', style: 'width:100%' }); modal({ title: `${m.page}쪽 책갈피 이름`, body: i, actions: [{ label: '취소' }, { label: '저장', primary: true, onClick: async () => { m.label = i.value.trim(); m.updatedAt = Date.now(); await dbx.put('bookmarks', m); refreshBm(); } }] }); } }),
      h('button', { class: 'btn sm ghost', text: '✕', 'aria-label': '책갈피 삭제', onclick: async () => { await delRecord('bookmarks', m.id); refreshBm(); } }))) : h('div', { class: 'empty', text: '책갈피가 없어요. 위쪽 ☆ 책갈피 버튼으로 현재 쪽에 꽂을 수 있어요' }));
}

/* ---------- PDF 찾기 ---------- */
let lastQuery = '', lastResults = null;
async function renderSearchTab() {
  const b = $('pbody');
  const inp = h('input', { type: 'search', value: lastQuery, placeholder: '단어·문장 검색', style: 'flex:1;min-width:0', onkeydown: (e) => { if (e.key === 'Enter') run(); } });
  const out = h('div', { style: 'margin-top:8px' });
  const draw = () => {
    if (!lastResults) { out.replaceChildren(h('div', { class: 'muted', text: '이 자료 안에서 글자를 찾아 해당 쪽으로 이동해요.' })); return; }
    if (lastResults.err) { out.replaceChildren(h('div', { class: 'notice warn', text: lastResults.err })); return; }
    out.replaceChildren(h('div', { class: 'muted', text: lastResults.list.length ? `${lastResults.list.length}개 쪽에서 ${lastResults.list.reduce((a, r) => a + r.count, 0)}건` : '결과가 없어요' }),
      lastResults.list.map((r) => h('div', { class: 'pi', onclick: () => { reader.setHighlight(lastQuery); reader.goto(r.page).then(() => reader.setHighlight(lastQuery)); } }, h('b', { text: `${r.page}쪽` }), h('span', { class: 'muted', text: `  ${r.count}건` }), h('div', { class: 'pv', style: 'white-space:normal' }, r.before, h('mark', { text: r.hit }), r.after))),
      lastResults.list.length ? h('button', { class: 'btn sm', text: '표시 지우기', onclick: () => reader.setHighlight('') }) : null);
  };
  async function run() {
    const q = inp.value.trim(); if (!q) return; lastQuery = q;
    out.replaceChildren(h('div', { class: 'muted', text: '검색 중…(처음 한 번은 글자를 읽는 데 시간이 걸려요)' }));
    try {
      const pages = await ensureText(current.id, await getBuffer(current.id), (n, t) => { out.firstChild.textContent = `글자 읽는 중 ${n}/${t}…`; });
      const scanned = pages.filter((p) => p.scanned || (p.chars ?? 1) < 30).length;
      lastResults = { list: searchPages(pages, q) };
      if (!lastResults.list.length && scanned >= pages.length * 0.5) lastResults = { err: '이 PDF는 글자 정보가 없는 스캔본이라 검색할 수 없어요. 지문 탭에서 OCR 분석을 실행하면 검색할 수 있어요.' };
      reader.setHighlight(lastResults.list.length ? q : '');
    } catch (e) { lastResults = { err: `검색하지 못했어요: ${e.message}` }; }
    draw();
  }
  b.replaceChildren(h('div', { class: 'sline' }, inp, h('button', { class: 'btn sm primary', text: '검색', onclick: run })), out);
  draw();
}

/* ---------- 설정 ---------- */
async function openSettings() {
  const est = await storageEstimate();
  const persisted = (await navigator.storage?.persisted?.()) ?? null;
  const mb = (n) => (n / 1048576).toFixed(0) + 'MB';
  const stor = h('div', { class: 'stack' },
    h('div', { text: est ? `사용 ${mb(est.used)} / 허용 ${mb(est.quota)}` : '저장 공간 정보를 알 수 없어요' }),
    h('div', { class: 'muted', text: persisted ? '저장소 보호: 켜짐 (브라우저가 임의로 지우지 않아요)' : '저장소 보호: 꺼짐 — Safari 는 오래 사용하지 않으면 사이트 데이터를 지울 수 있어요. 홈 화면에 추가하면 안전해요.' }),
    h('button', { class: 'btn sm', text: '저장소 보호 요청', onclick: async () => toast((await requestPersistence()) ? '보호를 허용했어요' : '브라우저가 허용하지 않았어요(홈 화면에 추가 후 다시 시도)') }));
  const health = h('div', { class: 'muted', text: '확인 중…' });
  checkHealth().then((r) => { health.textContent = r ? `서버 기능 사용 가능 (v${r.version}) · 동기화 ${r.features.sync} · 수집 출처 ${r.sources.map((s) => s.name.split(' · ')[0]).join(', ')}` : '서버 기능 사용 불가(정적 파일로만 열었거나 배포 전)'; });
  const backup = h('div', { class: 'row' },
    h('button', { class: 'btn', text: '백업 내보내기(JSON)', onclick: exportBackup }),
    h('button', { class: 'btn', text: '백업 불러오기', onclick: () => { const i = h('input', { type: 'file', accept: '.json,application/json' }); i.onchange = () => i.files[0] && importBackup(i.files[0]); i.click(); } }),
    h('button', { class: 'btn', text: 'v3 데이터 다시 가져오기', onclick: async () => { await setMeta('v3Migrated', false); const r = await migrateV3(); toast(r ? `가져옴: 자료 ${r.docs} · 필기 ${r.marks} · 메모 ${r.memos}` : 'v3 데이터가 이 브라우저에 없어요'); refreshLibrary(); } }));
  modal({ title: `설정 · v${VERSION}`, wide: true, actions: [{ label: '닫기', primary: true }], body: h('div', { class: 'stack' },
    h('div', {}, h('h3', { text: '저장소' }), stor),
    h('div', {}, h('h3', { text: '클라우드 동기화' }), syncPanel()),
    h('div', {}, h('h3', { text: '백업 / 이전' }), backup, h('div', { class: 'muted', text: '백업에는 필기·메모·분류·풀이 기록·자료 정보가 들어가요(PDF 파일 제외).' })),
    h('div', {}, h('h3', { text: '서버 기능' }), health)) });
}
$('btnSettings').onclick = openSettings; $('syncState').onclick = openSettings;
onSyncState((s) => { const el = $('syncState'); el.textContent = '동기화 ' + s.msg; el.className = 'pill ' + ({ ok: 'ok', busy: 'busy', err: 'err' }[s.status] || ''); el.title = s.msg; });

async function exportBackup() {
  const stores = {}; for (const s of ['docs', 'ink', 'memos', 'passages', 'sessions', 'bookmarks', 'studylog', 'todos']) stores[s] = (await dbx.all(s)).map((r) => (s === 'passages' ? (({ body, qtext, ...x }) => x)(r) : r));
  const blob = new Blob([JSON.stringify({ app: 'ohneul-chabunhi', version: VERSION, at: Date.now(), stores })], { type: 'application/json' });
  const { download } = await import('./util.js'); const d = new Date();
  download(`ohneul-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`, blob);
  toast('백업 파일을 만들었어요');
}
async function importBackup(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.app !== 'ohneul-chabunhi' || !j.stores) throw new Error('이 앱의 백업 파일이 아니에요');
    let n = 0, skip = 0;
    for (const [s, recs] of Object.entries(j.stores)) {
      if (!['docs', 'ink', 'memos', 'passages', 'sessions', 'bookmarks', 'studylog', 'todos'].includes(s)) continue;
      for (const r of recs) {
        const key = r.key || r.id; const old = await dbx.get(s, key);
        if (old && (old.updatedAt || 0) >= (r.updatedAt || 0)) { skip++; continue; }
        const rec = s === 'docs' ? { ...r, hasFile: !!old?.hasFile, hash: old?.hash || r.hash, analysis: old?.analysis } : s === 'passages' ? { ...r, body: old?.body || '', qtext: old?.qtext || '' } : r;
        await dbx.put(s, rec); n++;
      }
    }
    inkStore.forgetAll(); memoStore.forgetAll();
    toast(`백업을 불러왔어요: ${n}개 반영, ${skip}개는 더 최신이라 건너뜀`); refreshLibrary();
  } catch (e) { toast(`백업을 불러오지 못했어요: ${e.message}`, 'error', 8000); }
}

/* ---------- 부팅 ---------- */
(async function boot() {
  try { await openDB(); }
  catch (e) { return fatal('저장소를 열 수 없어요', e, 'Safari 의 “비공개 브라우징”이거나 저장소 접근이 차단된 경우일 수 있어요. 일반 창에서 다시 열어 주세요.'); }
  initLibrary({ onOpen: goOpen }); initCollect(); initStudy(); initSync();
  requestPersistence();
  try {
    const r = await migrateV3();
    if (r && (r.docs || r.marks || r.memos)) toast(`v3 데이터를 가져왔어요: 자료 ${r.docs}개 · 필기 ${r.marks}쪽 · 메모 ${r.memos}개`, 'info', 7000);
    if (r?.errors?.length) toast(`v3 일부를 가져오지 못했어요: ${r.errors[0]}`, 'error', 8000);
  } catch (e) { console.error(e); toast(`v3 데이터 가져오기 실패: ${e.message}`, 'error', 7000); }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {});
  await route();
  maybeShowYesterday().catch(() => {});
  window.__app = { reader, timer, memo, inkStore, memoStore, goOpen, syncNow }; // 테스트·디버깅용
})();
