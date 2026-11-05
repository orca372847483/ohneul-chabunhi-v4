// 기출 찾기(자동 수집) 화면. 서버 기능(/api/collect, /api/fetch-pdf)을 호출하고 항목별 성공/실패 상태를 보여 준다.
import { dbx } from './db.js';
import { h, toast, EXAMS, lsGet, lsSet } from './util.js';
import { addPdf } from './docs.js';
import { runAnalyze, yearOptions, setBusy } from './actions.js';
import { CATEGORIES } from './classify.js';
import { emit } from './events.js';

const $ = (id) => document.getElementById(id);
let category = '전체';

async function api(path) {
  let res;
  try { res = await fetch(path, { headers: { accept: 'application/json' } }); }
  catch { throw Object.assign(new Error('서버에 연결하지 못했어요. 인터넷 연결을 확인하세요'), { code: 'OFFLINE' }); }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) throw Object.assign(new Error('서버 기능(Netlify Functions)을 찾을 수 없어요. 정적 파일로만 열었거나 배포 설정이 빠졌을 수 있어요(README 참고)'), { code: 'NO_FUNCTIONS' });
  const body = await res.json();
  if (!res.ok || body.ok === false) throw Object.assign(new Error(body.message || `서버 오류(${res.status})`), { code: body.code, hint: body.hint });
  return body;
}

/** 공식 PDF 한 건을 서버 경유로 받아 자료함에 저장·분석한다. 결과: {ok, doc?, dup?, error?} */
export async function fetchPdfInto({ url, title, year, exam, month, pageUrl, sourceName, onStatus }) {
  const say = (s) => { onStatus?.(s); };
  try {
    const have = (await dbx.all('docs')).find((d) => d.hasFile && d.sourceUrl === url);
    if (have) { say({ t: 'dup', msg: '이미 자료함에 있어요' }); return { ok: true, dup: true, doc: have }; }
    say({ t: 'busy', msg: '내려받는 중…' });
    let res;
    try { res = await fetch('/api/fetch-pdf?url=' + encodeURIComponent(url)); }
    catch { throw new Error('서버에 연결하지 못했어요'); }
    if (!res.ok) {
      let m = {}; try { m = await res.json(); } catch { /* html 등 */ }
      throw new Error([m.message || `서버 오류(${res.status})`, m.hint].filter(Boolean).join(' — '));
    }
    const buf = await res.arrayBuffer();
    say({ t: 'busy', msg: '저장 중…' });
    const r = await addPdf(buf, { title, year, exam, month, source: 'collect', sourceName, sourceUrl: url, pageUrl, fileName: decodeURIComponent(res.headers.get('x-file-name') || '') });
    if (r.dup) { say({ t: 'dup', msg: r.reason }); return { ok: true, dup: true, doc: r.doc }; }
    emit('data');
    say({ t: 'busy', msg: '지문 분석 중…' });
    await runAnalyze(r.doc.id, { quiet: true });
    say({ t: 'ok', msg: `추가 완료 (${r.doc.pages}쪽)` });
    toast(`“${r.doc.title}” 자료함에 추가했어요`);
    return { ok: true, doc: r.doc };
  } catch (e) {
    say({ t: 'err', msg: e.message });
    toast(e.message, 'error', 8000);
    return { ok: false, error: e.message };
  } finally { setBusy(''); }
}

const reqText = (y, ex) => `${y}학년도 ${EXAMS[ex] || ex} 국어 ${category === '전체' ? '독서·문학·화법·작문·언어·매체' : category + ' 지문'} 기출문제와 공식 PDF 원문을 찾아줘. 평가원·교육청·EBSi 공식 출처를 우선하고, 지문명·문항 번호·정답 근거를 정리해줘`;

function renderResult(data) {
  const box = $('cResult'); box.replaceChildren();
  const statusCls = data.status === 'ok' ? '' : data.status === 'failed' ? ' warn' : '';
  box.append(h('div', { class: 'notice' + statusCls, text: data.message }));
  box.append(h('div', { class: 'muted', style: 'margin:8px 0 4px', text: '출처별 접속 결과' }));
  const tbl = h('table', { class: 'att' }, h('tr', {}, ['출처', '결과', '상세'].map((x) => h('th', { text: x }))));
  for (const a of data.attempts) tbl.append(h('tr', {}, h('td', { text: a.name + (a.verified ? '' : ' (주소 미검증)') }), h('td', { class: 'st ' + (a.ok ? 'ok' : 'err'), text: a.ok ? `접속됨 · 목록 ${a.pages}쪽 · 게시글 ${a.posts}건 확인` : `실패 [${a.layer ? a.layer + ' · ' : ''}${a.code || 'ERROR'}]` }), h('td', { class: 'muted', text: [a.error, a.hint, a.note].filter(Boolean).join(' / ') })));
  box.append(tbl);
  if (!data.items.length) {
    box.append(h('div', { class: 'muted', style: 'margin-top:10px', text: '직접 확인할 수 있는 공식 포털:' }), h('div', { class: 'row', style: 'margin-top:6px' }, data.portals.map((p) => h('a', { class: 'btn', href: p.url, target: '_blank', rel: 'noopener', text: p.title + ' ↗' }))));
    return;
  }
  const pdfs = data.items.filter((i) => i.kind === 'pdf');
  const head = h('div', { class: 'row', style: 'margin:12px 0 6px' }, h('b', { text: `찾은 자료 ${data.items.length}건` }), h('span', { class: 'sp' }));
  const rows = [];
  const items = h('div', { class: 'items' });
  const exam = data.query.exam;
  for (const it of data.items) {
    const st = h('span', { class: 'st', text: it.kind === 'pdf' ? '대기' : '공식 게시글 링크' });
    const btn = it.kind === 'pdf'
      ? h('button', { class: 'btn sm primary', text: '자료함에 추가' })
      : h('a', { class: 'btn sm', href: it.url, target: '_blank', rel: 'noopener', text: '공식 페이지 열기 ↗' });
    const run = async () => {
      if (it.kind !== 'pdf') return;
      btn.disabled = true;
      const r = await fetchPdfInto({
        url: it.url, title: `${it.year}학년도 ${it.month ? it.month + '월 ' : ''}${EXAMS[exam]} 국어${it.part && it.part !== '기타' ? ' ' + it.part : ''}`.replace('교육청 학력평가', it.month ? '학력평가' : '학력평가'),
        year: it.year, exam, month: it.month || data.query.month, pageUrl: it.pageUrl, sourceName: it.sourceName,
        onStatus: (s) => { st.className = 'st ' + (s.t === 'ok' ? 'ok' : s.t === 'err' ? 'err' : ''); st.textContent = s.msg; },
      });
      btn.disabled = false; if (r.ok) btn.textContent = '추가됨'; else btn.textContent = '다시 시도';
      return r;
    };
    if (it.kind === 'pdf') btn.onclick = run;
    rows.push({ it, run });
    items.append(h('div', { class: 'card item' },
      h('div', {}, h('div', { class: 'it', text: it.title }), h('div', { class: 'muted', text: `${it.sourceName} · ${it.host || ''}${it.part && it.part !== '기타' ? ' · ' + it.part : ''}${it.subject === 'unknown' ? ' · 과목 미확인' : ''}${it.note ? ' · ' + it.note : ''}` }), st),
      h('div', { class: 'row' }, btn, it.pageUrl && it.kind === 'pdf' ? h('a', { class: 'btn sm', href: it.pageUrl, target: '_blank', rel: 'noopener', text: '출처 ↗' }) : null)));
    // 이미 저장된 자료 표시
    dbx.all('docs').then((ds) => { if (ds.some((d) => d.hasFile && d.sourceUrl === it.url)) { st.textContent = '이미 자료함에 있어요'; st.className = 'st ok'; btn.textContent = '추가됨'; } });
  }
  if (pdfs.length > 1) {
    head.append(h('button', { class: 'btn sm', text: `PDF ${pdfs.length}건 모두 추가`, onclick: async (e) => { e.currentTarget.disabled = true; for (const r of rows.filter((x) => x.it.kind === 'pdf')) await r.run(); e.currentTarget.disabled = false; } }));
  }
  box.append(head, items);
}

export async function checkHealth() {
  const el = $('cHealth');
  try {
    const hres = await api('/api/health');
    el.textContent = `서버 기능 사용 가능 · 출처 ${hres.sources.length}곳`;
    return hres;
  } catch (e) { el.textContent = `서버 기능 사용 불가: ${e.message}`; return null; }
}

export function initCollect() {
  const last = lsGet('collect-v4', {});
  yearOptions($('cYear'), { selected: last.year });
  if (last.exam) $('cExam').value = last.exam;
  const syncMonth = () => { $('cMonth').hidden = $('cExam').value !== 'office'; refreshReq(); };
  $('cExam').onchange = syncMonth; $('cYear').onchange = refreshReq;
  syncMonth();
  $('cCats').replaceChildren(...['전체', ...CATEGORIES].map((c) => h('button', { class: 'chip' + (c === category ? ' on' : ''), text: c, onclick: (e) => { category = c; [...$('cCats').children].forEach((x) => x.classList.toggle('on', x === e.currentTarget)); refreshReq(); } })));
  $('cFind').onclick = async () => {
    const year = +$('cYear').value, exam = $('cExam').value, month = $('cMonth').value;
    lsSet('collect-v4', { year, exam });
    const btn = $('cFind'); btn.disabled = true; btn.textContent = '찾는 중…';
    $('cResult').replaceChildren(h('div', { class: 'muted', text: '공식 출처에 접속하는 중이에요(수십 초 걸릴 수 있어요)…' }));
    try { renderResult(await api(`/api/collect?year=${year}&exam=${exam}${exam === 'office' && month ? '&month=' + month : ''}`)); }
    catch (e) {
      $('cResult').replaceChildren(h('div', { class: 'notice warn' }, h('b', { text: '자동 수집을 실행하지 못했어요. ' }), e.message, e.hint ? ` — ${e.hint}` : ''), h('div', { class: 'muted', style: 'margin-top:8px', text: '아래 “직접 찾기 도움”이나 공식 포털에서 PDF를 내려받아 자료함의 ‘내 PDF 추가’로 불러올 수 있어요.' }));
    } finally { btn.disabled = false; btn.textContent = '공식 출처에서 찾기'; }
  };
  $('cDiag').onclick = async () => {
    const btn = $('cDiag'); btn.disabled = true; btn.textContent = '진단 중…';
    $('cResult').replaceChildren(h('div', { class: 'muted', text: '출처마다 DNS → 연결 → 응답 → 리다이렉트 → 접근 제한 → 페이지 구조 순서로 확인하는 중…' }));
    try {
      const d = await api(`/api/diagnose?year=${$('cYear').value}&exam=${$('cExam').value}`);
      $('cResult').replaceChildren(...d.reports.map((r) => h('div', { class: 'card stack', style: 'margin-bottom:8px' },
        h('div', {}, h('b', { text: `${r.verdict.ok ? '✅' : '❌'} ${r.name}` }), h('span', { class: 'muted', text: `  ${r.verdict.code}` })),
        h('div', { class: r.verdict.ok ? '' : 'st err', text: r.verdict.text }),
        h('table', { class: 'att' }, r.steps.map((x) => h('tr', {}, h('td', { text: (x.ok ? '✓ ' : '✗ ') + x.label }), h('td', { class: 'muted', text: x.detail })))),
        h('div', { class: 'muted', text: r.url }))), h('div', { class: 'muted', text: 'PDF 를 직접 내려받아 “내 PDF 추가”로 넣는 방법은 언제든 쓸 수 있어요.' }));
    } catch (e) { $('cResult').replaceChildren(h('div', { class: 'notice warn', text: `진단을 실행하지 못했어요: ${e.message}` })); }
    finally { btn.disabled = false; btn.textContent = '연결 진단'; }
  };
  $('cWeb').onclick = () => window.open('https://www.google.com/search?q=' + encodeURIComponent(reqText($('cYear').value, $('cExam').value) + ' 공식 PDF'), '_blank', 'noopener');
  $('cCopy').onclick = () => copyReq();
  $('cChat').onclick = async () => { await copyReq(true); window.open('https://chatgpt.com/', '_blank', 'noopener'); };
}
async function copyReq(quiet) {
  const q = reqText($('cYear').value, $('cExam').value);
  try { await navigator.clipboard.writeText(q); toast('검색 문장을 복사했어요' + (quiet ? '. 대화창에 붙여넣으세요' : '')); }
  catch { window.prompt('아래 문장을 복사하세요', q); }
}
function refreshReq() { $('cReq').textContent = reqText($('cYear').value, $('cExam').value); }
export function onShowCollect() { refreshReq(); checkHealth(); }
