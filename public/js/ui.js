// 공용 모달(네이티브 alert/confirm 대신 사용: iPad Safari 에서 포커스·스크롤 문제가 적음)
import { h } from './util.js';

export function modal({ title, body, actions = [], onClose, wide = false }) {
  const ov = h('div', { class: 'ov', role: 'dialog', 'aria-modal': 'true' });
  const close = () => { ov.remove(); onClose?.(); };
  const box = h('div', { class: 'modal', style: wide ? 'max-width:760px' : '' },
    title ? h('header', { text: title }) : null,
    h('div', { class: 'mb' }, body),
    actions.length ? h('footer', {}, actions.map((a) => h('button', {
      class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
      text: a.label,
      onclick: async (e) => { const r = await a.onClick?.(e, close); if (r !== false && !a.keep) close(); },
    }))) : null);
  ov.append(box);
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov && !actions.some((a) => a.primary)) close(); });
  document.body.append(ov);
  return { close, el: box };
}

export function confirmBox(message, { ok = '확인', cancel = '취소', danger = false, title = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    modal({
      title, body: h('div', { style: 'white-space:pre-line;line-height:1.6', text: message }),
      actions: [{ label: cancel, onClick: () => fin(false) }, { label: ok, primary: !danger, danger, onClick: () => fin(true) }],
      onClose: () => fin(false),
    });
  });
}

export function notify(title, message) {
  return new Promise((resolve) => modal({ title, body: h('div', { style: 'white-space:pre-line;line-height:1.6', text: message }), actions: [{ label: '확인', primary: true }], onClose: resolve }));
}
