// GET /api/collect?year=2026&exam=csat|jun|sep|office[&month=10]
// 공식 게시판 목록 → 제목 매칭 → 상세 페이지의 첨부(PDF) 링크 수집. 로그인/접근 제한은 우회하지 않는다.
import { makeContext, fetchText, FetchError, errorBody, jsonResponse } from './lib/guard.mjs';
import { parseAnchors, matchTitle, isPdfLike, attachmentPart, monthOf } from './lib/parse.mjs';
import { getSources, PORTALS } from './lib/sources.mjs';

export const config = { path: '/api/collect' };

const EXAM_LABEL = { csat: '대학수학능력시험', jun: '6월 모의평가', sep: '9월 모의평가', office: '교육청 학력평가' };
const MAX_DETAIL = 6;

export async function collect({ year, exam, month }, env = process.env) {
  const ctx = makeContext(env);
  const sources = getSources(env).filter((s) => s.exams.includes(exam));
  const attempts = [];
  const items = new Map(); // url → item
  const put = (it) => { const k = it.url; if (!items.has(k)) items.set(k, it); };

  for (const src of sources) {
    const at = { source: src.id, name: src.name, verified: !!src.verified, ok: false, pages: 0, posts: 0, error: null, code: null, note: null };
    attempts.push(at);
    const posts = [];
    try {
      for (let page = 1; page <= (src.maxPages || 1); page++) {
        const url = src.listUrl.replace('{page}', page);
        const { html, url: finalUrl } = await fetchText(url, ctx);
        at.pages++;
        const anchors = parseAnchors(html, finalUrl);
        if (page === 1 && !anchors.length) at.note = '목록 페이지에서 링크를 찾지 못했습니다(스크립트로 그려지는 페이지일 수 있음)';
        let matchedHere = 0;
        for (const a of anchors) {
          const label = a.text || a.title;
          // 제목에 연도 표기가 없는 첨부 링크만 같은 행의 앞쪽 문맥을 함께 본다(다른 행의 제목을 끌어오는 오탐 방지)
          const ok = matchTitle(label, { year, exam, month }) || (isPdfLike(a) && !/학년도|\d{4}\s*년/.test(label) && matchTitle(a.before + ' ' + label, { year, exam, month }));
          if (!ok) continue;
          matchedHere++;
          if (isPdfLike(a)) put(makeItem({ a, label, year, exam, src, pageUrl: finalUrl, kind: 'pdf' }));
          else if (a.url) posts.push({ a, label, pageUrl: finalUrl });
        }
        at.ok = true;
        if (src.maxPages > 1 && matchedHere === 0 && page >= 2 && posts.length) break;
        if (items.size + posts.length >= MAX_DETAIL * 2) break;
      }
      // 상세 페이지에서 첨부 링크 찾기
      const seen = new Set();
      for (const p of posts.slice(0, MAX_DETAIL)) {
        if (seen.has(p.a.url)) continue; seen.add(p.a.url);
        at.posts++;
        let found = 0;
        try {
          const { html, url } = await fetchText(p.a.url, ctx);
          const atts = parseAnchors(html, url).filter(isPdfLike);
          const hasKorean = atts.some((x) => /국어/.test(x.text + x.url));
          for (const f of atts) {
            const lbl = f.text || f.title || '';
            if (hasKorean && !/국어/.test(lbl + f.url)) continue;
            put(makeItem({ a: f, label: lbl || p.label, postTitle: p.label, year, exam, src, pageUrl: url, kind: 'pdf', subject: /국어/.test(lbl + f.url) ? '국어' : 'unknown' }));
            found++;
          }
        } catch (e) {
          at.note = (at.note ? at.note + ' / ' : '') + `상세 페이지 실패: ${e.message}`;
        }
        if (!found) put({ ...makeItem({ a: p.a, label: p.label, year, exam, src, pageUrl: p.a.url, kind: 'page' }), note: 'PDF 첨부를 자동으로 찾지 못해 공식 게시글로 연결합니다' });
      }
    } catch (e) {
      at.ok = false; at.error = e.message; at.code = e.code || 'ERROR';
      if (e instanceof FetchError) { at.hint = errorBody(e).hint; at.layer = e.layer || null; }
    }
  }

  const list = [...items.values()];
  const pdfs = list.filter((i) => i.kind === 'pdf').length;
  const reachable = attempts.some((a) => a.ok);
  const status = pdfs ? 'ok' : list.length ? 'partial' : reachable ? 'none' : 'failed';
  const message = {
    ok: `공식 출처에서 PDF ${pdfs}건을 찾았습니다.`,
    partial: '공식 게시글은 찾았지만 PDF 첨부를 자동으로 확인하지 못했습니다. 공식 페이지에서 직접 내려받아 추가해 주세요.',
    none: '접속은 되었지만 조건에 맞는 자료를 찾지 못했습니다(해당 연도·시험이 게시판에 없거나 목록 구조가 달라졌을 수 있음).',
    failed: '모든 공식 출처에 접속하지 못했습니다. 아래 실패 사유를 확인하세요.',
  }[status];
  return { ok: true, status, message, query: { year, exam, month: month || null, label: EXAM_LABEL[exam] }, items: list, attempts, portals: PORTALS.all, at: new Date().toISOString() };
}

function makeItem({ a, label, postTitle, year, exam, src, pageUrl, kind, subject }) {
  const title = (label || postTitle || '').trim() || `${year}학년도 ${EXAM_LABEL[exam]}`;
  return {
    id: hash(a.url || title), title: title.slice(0, 160), postTitle: postTitle || null, year, exam, month: monthOf(postTitle || label),
    subject: subject || (/국어/.test(title) ? '국어' : 'unknown'), part: attachmentPart(title),
    kind, url: a.url, pageUrl, source: src.id, sourceName: src.name, host: a.url ? new URL(a.url).host : null,
  };
}

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export default async (req) => {
  const u = new URL(req.url);
  const year = parseInt(u.searchParams.get('year'), 10);
  const exam = u.searchParams.get('exam');
  const month = parseInt(u.searchParams.get('month'), 10) || null;
  if (!(year >= 2005 && year <= 2100) || !['csat', 'jun', 'sep', 'office'].includes(exam)) {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', message: 'year(2005~)와 exam(csat|jun|sep|office)이 필요합니다' }, 400);
  }
  try { return jsonResponse(await collect({ year, exam, month })); }
  catch (e) { return jsonResponse(errorBody(e), 500); }
};
