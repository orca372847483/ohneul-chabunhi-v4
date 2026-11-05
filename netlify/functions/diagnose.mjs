// GET /api/diagnose?year=2025&exam=csat[&month=] — 등록된 출처마다 실패 원인을 계층별로 진단한다(자료 수집은 하지 않음).
import { getSources, PORTALS } from './lib/sources.mjs';
import { diagnoseUrl } from './lib/diagnose.mjs';
import { jsonResponse } from './lib/guard.mjs';
export const config = { path: '/api/diagnose' };
export default async (req) => {
  const u = new URL(req.url);
  const year = parseInt(u.searchParams.get('year'), 10) || new Date().getFullYear(), exam = u.searchParams.get('exam') || 'csat', month = parseInt(u.searchParams.get('month'), 10) || null;
  const reports = [];
  for (const s of getSources(process.env).filter((x) => x.exams.includes(exam))) reports.push({ id: s.id, name: s.name, verifiedBefore: !!s.verified, ...(await diagnoseUrl(s.listUrl.replace('{page}', 1), { year, exam, month })) });
  return jsonResponse({ ok: true, query: { year, exam, month }, reports, portals: PORTALS.all, at: new Date().toISOString() });
};
