// 지문 분류 표시·수정 UI (자료함 · 시험지 패널 공용)
import { dbx } from './db.js';
import { h, uid, toast } from './util.js';
import { modal } from './ui.js';
import { CATEGORIES, confidenceLabel } from './classify.js';
import { reclassify } from './analyze.js';

export const qRange = (p) => (p.qFrom ? `${p.qFrom}~${p.qTo}번` : '문항 미확인');
export const pageRange = (p) => (p.pageFrom === p.pageTo ? `${p.pageFrom}쪽` : `${p.pageFrom}~${p.pageTo}쪽`);

export function tagChips(p) {
  if (!p.tags?.length) return [h('span', { class: 'chip tag', text: '미분류' })];
  return p.tags.map((t) => h('span', { class: 'chip tag' + (p.manual ? ' man' : ''), text: t.label }));
}
export function confText(p) {
  if (p.manual) return '직접 지정';
  if (p.status === 'needs-manual') return '수동 분류 필요';
  return `자동 · 확신 ${confidenceLabel(p.confidence)}(${Math.round((p.confidence || 0) * 100)}%)`;
}

/** 분류 근거 + 수정 모달. onSaved(record) */
export function editPassage(p, onSaved) {
  const sel = new Set((p.tags || []).map((t) => t.label));
  const grid = h('div', { class: 'chips' });
  const draw = () => { grid.replaceChildren(...CATEGORIES.map((c) => h('button', { class: 'chip' + (sel.has(c) ? ' on' : ''), text: c, onclick: () => { sel.has(c) ? sel.delete(c) : sel.add(c); draw(); } }))); };
  draw();
  const ev = h('div', {});
  const evEntries = Object.entries(p.evidence || {});
  if (!evEntries.length) ev.append(h('div', { class: 'muted', text: '자동 분류 근거가 없어요' }));
  for (const [tag, lines] of evEntries) ev.append(h('div', { style: 'margin:6px 0' }, h('b', { text: tag }), h('ul', { style: 'margin:2px 0 0 18px;padding:0;font-size:12px;color:var(--mute)' }, (lines || []).map((l) => h('li', { text: l })))));
  const excerpt = (p.body || p.preview || '').slice(0, 420);
  const body = h('div', {},
    h('div', { class: 'muted', text: `${qRange(p)} · ${pageRange(p)} · ${confText(p)}` }),
    p.heading ? h('div', { style: 'margin:6px 0;font-weight:600', text: p.heading }) : null,
    h('pre', { class: 'code', style: 'white-space:pre-wrap;max-height:120px', text: excerpt + (p.body?.length > 420 ? ' …' : '') }),
    h('h3', { text: '분류 근거' }), ev,
    h('h3', { style: 'margin-top:12px', text: '태그 직접 선택 (여러 개 가능)' }), grid);
  const save = async () => {
    const tags = CATEGORIES.filter((c) => sel.has(c)).map((c) => ({ label: c, score: null }));
    const rec = { ...p, tags, primary: tags[0]?.label || null, manual: true, status: tags.length ? 'manual' : 'needs-manual', confidence: tags.length ? 1 : 0, evidence: Object.fromEntries(tags.map((t) => [t.label, ['사용자가 직접 지정']])), updatedAt: Date.now() };
    await dbx.put('passages', rec); onSaved?.(rec); toast('분류를 저장했어요');
  };
  const actions = [{ label: '닫기' }];
  if (p.body && p.manual) actions.push({ label: '자동 분류로 되돌리기', onClick: async () => { const r = reclassify(p); await dbx.put('passages', r); onSaved?.(r); toast('자동 분류로 되돌렸어요'); } });
  actions.push({ label: '저장', primary: true, onClick: save });
  modal({ title: `지문 분류 · ${p.heading ? p.heading.slice(0, 24) : qRange(p)}`, body, actions, wide: true });
}

/** 지문 직접 추가(자동 분할 실패 시 수동 분류용) */
export function addPassage(doc, onSaved) {
  const f = (label, id, val, ph = '') => h('div', { class: 'field' }, h('label', { text: label }), h('input', { type: 'number', id, value: val, placeholder: ph, inputmode: 'numeric' }));
  const body = h('div', {}, h('div', { class: 'muted', text: '지문이 들어 있는 쪽과 문항 번호를 입력하면 그 지문을 직접 분류할 수 있어요.' }),
    h('div', { class: 'row' }, f('시작 쪽', 'ap1', 1), f('끝 쪽', 'ap2', 1), f('문항 시작(선택)', 'aq1', '', '예: 1'), f('문항 끝(선택)', 'aq2', '', '예: 3')),
    h('div', { class: 'field' }, h('label', { text: '메모(선택)' }), h('input', { type: 'text', id: 'ah', placeholder: '예: (가) 문학 지문' })));
  modal({
    title: '지문 직접 추가', body,
    actions: [{ label: '취소' }, {
      label: '추가', primary: true, onClick: async (e, close) => {
        const g = (id) => +body.querySelector('#' + id).value || null;
        const pf = g('ap1'), pt = g('ap2') || pf;
        if (!pf || pf > doc.pages || pt < pf) { toast('쪽 번호를 확인하세요', 'error'); return false; }
        const all = await dbx.byIndex('passages', 'docId', doc.id);
        const idx = Math.max(1000, ...all.map((x) => x.idx)) + 1;
        const rec = { id: `${doc.id}|${idx}`, docId: doc.id, idx, qFrom: g('aq1'), qTo: g('aq2') || g('aq1'), pageFrom: pf, pageTo: pt, heading: body.querySelector('#ah').value.trim(), section: null, fallback: false, preview: body.querySelector('#ah').value.trim() || '직접 추가한 지문', body: '', qtext: '', tags: [], primary: null, confidence: 0, status: 'needs-manual', evidence: {}, method: 'manual', manual: true, updatedAt: Date.now() };
        await dbx.put('passages', rec); onSaved?.(rec); close(); editPassage(rec, onSaved);
        return false;
      },
    }],
  });
}
void uid;
