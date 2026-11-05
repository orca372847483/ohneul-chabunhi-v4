// 공식 출처 설정.
// ⚠️ 아래 기본 주소는 공개된 구조를 바탕으로 한 "후보"이며, 개발 환경에서 실제 사이트 응답으로 검증하지 못했다(verified:false).
//    배포 후 `npm run check:sources` 로 확인하고, 주소가 다르면 환경변수 SOURCES_JSON 으로 덮어쓰면 된다.
//
// 필드: id, name, exams(csat|jun|sep|office), listUrl({page} 치환), maxPages, verified, note
export const DEFAULT_SOURCES = [
  {
    id: 'suneung-csat', name: '수능 누리집(한국교육과정평가원) · 수능 기출문제', exams: ['csat'],
    listUrl: 'https://www.suneung.re.kr/boardCnts/list.do?boardID=1500234&m=0403&s=suneung&page={page}',
    maxPages: 6, verified: false,
  },
  {
    id: 'suneung-mock', name: '수능 누리집(한국교육과정평가원) · 모의평가 기출문제', exams: ['jun', 'sep'],
    listUrl: 'https://www.suneung.re.kr/boardCnts/list.do?boardID=1500235&m=0404&s=suneung&page={page}',
    maxPages: 6, verified: false,
  },
  {
    id: 'ebsi-past', name: 'EBSi · 기출문제', exams: ['csat', 'jun', 'sep', 'office'],
    listUrl: 'https://www.ebsi.co.kr/ebs/xip/xipc/previousPaperList.ebs',
    maxPages: 1, verified: false,
  },
];

// 사용자가 직접 열어 확인할 수 있는 공식 포털(자동 수집 결과가 아님)
export const PORTALS = {
  all: [
    { title: '수능 누리집 (한국교육과정평가원)', url: 'https://www.suneung.re.kr/' },
    { title: '한국교육과정평가원', url: 'https://www.kice.re.kr/' },
    { title: 'EBSi 기출문제', url: 'https://www.ebsi.co.kr/' },
  ],
};

export function getSources(env = process.env) {
  if (env.SOURCES_JSON) {
    try {
      const v = JSON.parse(env.SOURCES_JSON);
      if (Array.isArray(v)) return v;
    } catch { /* fall through */ }
  }
  return DEFAULT_SOURCES;
}
