// 필기 도구 상태(시험지 필기와 메모가 색·굵기를 따로 가진다). 브라우저를 다시 열어도 유지.
import { lsGet, lsSet } from './util.js';

export const COLORS = ['#141414', '#c62828', '#1565c0', '#2e7d32', '#8a8a85'];
export const INPUTS = [
  { id: 'pen', label: '✎ 펜슬만', hint: 'Apple Pencil 로만 필기하고 손가락은 이동·확대에 사용' },
  { id: 'all', label: '☝ 손가락도', hint: '손가락으로도 필기(두 손가락은 확대/축소)' },
  { id: 'view', label: '✋ 보기만', hint: '필기하지 않고 보기만' },
];

const saved = lsGet('tools-v4', {});
export const paperTool = { input: saved.input || 'pen', tool: 'pen', color: saved.color || COLORS[0], width: saved.width || 3 };
export const memoTool = { input: 'all', tool: 'pen', color: saved.mcolor || COLORS[0], width: saved.mwidth || 3 };
export const persistTools = () => lsSet('tools-v4', { input: paperTool.input, color: paperTool.color, width: paperTool.width, mcolor: memoTool.color, mwidth: memoTool.width });
