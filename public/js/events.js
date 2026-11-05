// 아주 작은 이벤트 버스
const m = new Map();
export const on = (n, f) => { (m.get(n) || m.set(n, new Set()).get(n)).add(f); return () => m.get(n)?.delete(f); };
export const emit = (n, d) => { m.get(n)?.forEach((f) => { try { f(d); } catch (e) { console.error(e); } }); };
