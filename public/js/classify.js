// 지문 자동 분류 (규칙 기반, 브라우저/Node 공용)
// - 파일명이 아니라 지문 본문 + 문항 발문의 내용을 분석한다.
// - 복수 태그 허용, 분류 근거(evidence) 반환, 확신이 없으면 'needs-manual'.

export const CATEGORIES = [
  '경제', '인문', '사회·문화', '정치·법', '과학', '기술', '예술', '언어', '융합',
  '현대시', '현대소설', '고전시가', '고전소설', '극·수필', '화법과 작문', '언어와 매체',
];
export const READING = ['경제', '인문', '사회·문화', '정치·법', '과학', '기술', '예술', '언어'];
export const LITERATURE = ['현대시', '현대소설', '고전시가', '고전소설', '극·수필'];
export const SELECT = ['화법과 작문', '언어와 매체'];

const L = (s) => s.split(',').map((x) => { const [k, w] = x.trim().split(':'); return [k.trim(), Number(w) || 1]; });

// [키워드, 가중치]. 공백은 무시하고 매칭한다.
const LEX = {
  '경제': L('수요:2,공급:2,가격:1,시장:1,금리:2,이자:1.5,투자:1.5,자본:1.5,환율:2,인플레이션:2,채권:2,주식:2,주가:1.5,보험:1.5,화폐:2,소비자:1.5,소득:1.5,이윤:2,재화:2,효용:2,한계효용:2.5,거래:1,경제:2,재정:1.5,통화:2,은행:1.5,대출:1.5,파생상품:2.5,독점:1.5,세금:1.5,조세:2,무역:1.5,관세:1.5,물가:2,유동성:2,자산:1.5,부채:1.5,금융:2,가계:1.5,공공재:2,외부효과:2,기업:1,생산:0.8,수익:1,비용:1,경기:0.6,저축:1.5,수출:1.5,수입:1'),
  '인문': L('철학:2,사상:1.5,윤리:1.5,도덕:1.5,인식:1,존재:1,이성:1.5,경험론:2.5,합리론:2.5,칸트:2.5,플라톤:2.5,아리스토텔레스:2.5,공자:2.5,맹자:2.5,주자:2.5,성리학:2.5,유학:2,불교:1.5,도가:2,노자:2.5,장자:2.5,자아:1.5,정신:1,역사:1,사료:2,사관:2,고증:1.5,담론:1.5,해석학:2.5,현상학:2.5,실존:2,변증법:2.5,형이상학:2.5,인식론:2.5,심리학:2,인지:1,종교:1.5,신화:1.5,덕:0.6,인간:0.5,주체:1,의지:0.8,논리:0.8,개념:0.5,관념:1.5,진리:1.5,선현:2,학문:1'),
  '사회·문화': L('사회:1.5,문화:1.5,집단:1,계층:2,제도:1,공동체:1.5,여론:2,미디어:1.5,대중:1.5,소비:1,사회학:2.5,규범:1.5,관습:1.5,인류학:2.5,도시:1,가족:1,교육:1,불평등:2,정체성:1.5,세대:1.5,노동:1.5,관료제:2.5,커뮤니케이션:1.5,언론:1.5,광고:1,복지:1.5,양극화:2,시민:1,공론장:2.5,전통:1,유행:1.5,직업:1,소비사회:2'),
  '정치·법': L('법률:2,법원:2,판결:2,헌법:2.5,소송:2,계약:1.5,조항:1.5,권리:1.5,의무:1,책임:0.8,형법:2.5,민법:2.5,처벌:1.5,범죄:2,정부:1.5,국가:1,정치:2,민주:1.5,선거:2,권력:2,입법:2.5,사법:2.5,행정:2,법적:1.5,위헌:2.5,주권:2,국회:2,의회:2,재판:2,과실:2,고의:2,채무:2,채권자:2.5,효력:1.5,법치:2.5,판례:2.5,피고:2.5,원고:2.5,청구:1.5,위법:2.5,법인:2,재산권:2.5,공권력:2.5,정당성:1.5,자유주의:1.5,공화:1.5'),
  '과학': L('물질:1.5,에너지:1.5,세포:2,입자:2,유전자:2.5,반응:1,원자:2,분자:2,파장:2,실험:1,단백질:2.5,전자:1.5,중력:2.5,광합성:2.5,진화:2,생물:2,화학:2,물리:2,효소:2.5,DNA:2.5,바이러스:2.5,면역:2.5,호르몬:2.5,온도:1,압력:1.5,우주:2,행성:2,천체:2,양자:2.5,상대성:2.5,원소:2,이온:2.5,방사:2,진동:1.5,질량:2,신경:2,생태:2,기체:2,액체:1.5,고체:1.5,가속:1.5,밀도:1.5,산소:1.5,탄소:1.5,관측:1.5,가설:1'),
  '기술': L('알고리즘:2.5,컴퓨터:2,데이터:1.5,네트워크:2,센서:2.5,암호:2.5,반도체:2.5,기계:1.5,공정:2,시스템:1.5,압축:2,인공지능:2.5,장치:1.5,소프트웨어:2.5,프로그램:1.5,전송:1.5,신호:1.5,부호화:2.5,통신:2,디지털:2,아날로그:2.5,블록체인:3,인터넷:2,기술:1.5,공학:2,엔진:2,제어:2,필터:2,해시:2.5,디스플레이:2.5,카메라:2,로봇:2.5,배터리:2.5,메모리:2,서버:2,클라우드:2.5,이미지센서:3,전류:2,전압:2,회로:2,기기:1.5,자동화:2,처리:0.6,구현:0.8'),
  '예술': L('미술:2,음악:2,회화:2.5,건축:2,영화:2,사진:1.5,작품:1,화가:2,미학:2.5,조형:2.5,연주:2,조각:2,예술:2,화음:2.5,선율:2.5,리듬:1.5,색채:2,구도:2,관객:1.5,무용:2,전시:1.5,작곡:2.5,악기:2.5,인상주의:3,입체주의:3,원근법:3,캔버스:2.5,감상:0.8,디자인:1.5,미적:2,화풍:3,양식:1.2,서사극:2'),
  '언어': L('언어학:3,기호학:3,기호:1.5,의미론:3,음성:2,문자:1.5,번역:2,화용론:3,어휘:1.5,방언:2.5,언어:1.5,말뭉치:3,담화:2,수화:2.5,어순:2.5,촘스키:3,소쉬르:3,언어습득:2.5,언어능력:2.5,지시어:2,발화:1.5,문법:1,음운:1.5,기표:3,기의:3,은유:2'),
  '현대시': L('화자:2,시어:2.5,시적:2,운율:2.5,정서:1.5,이미지:1.5,시구:3,어조:2.5,시상:3,선경후정:3,감각적:2,반복:1,표현상:1.5,시인:2,상징:1.5,역설:2,영탄:3,의인화:2.5,대구:2,수미상관:3,시행:3,연:0.4,시선:1,객관적상관물:3,공간:0.5,시적대상:3'),
  '현대소설': L('서술자:2.5,인물:1.5,갈등:1.5,서술:1.5,사건:1,장면:1.5,앞부분의줄거리:4,시점:2,내면:2,심리:1.5,묘사:1.5,대화:1,주인공:2,작중:2.5,소설:3,전지적:3,일인칭:3,관찰자:3,서사:1.5,독백:2,회상:1.5,어머니:0.5,아버지:0.5,아내:0.5,남편:0.5,그는:1,그녀는:1,말했다:1.5,물었다:1.5,대답했다:1.5'),
  '고전시가': L('시조:3,가사:1.5,연시조:3,한시:3,초장:3,중장:3,종장:3,고시조:3,사설시조:3,율격:2,3·4조:3,4음보:3,음보:3,낙구:3,서정적자아:2,임:1,님:1,강호:2,전원:1,유배:1.5,연군:2,충절:2,안빈낙도:3,자연친화:2,고전시가:3,작가미상:3,현대어풀이:3,주석:1'),
  '고전소설': L('하더라:3,이르되:3,아뢰:3,분부:2.5,소저:3,낭자:3,승상:3,상공:3,장군:1.5,하직:2.5,사이다:3,나이다:3,소서:3,천자:3,용왕:3,도령:2,노복:3,옥황:3,나으리:2.5,하되:2,전기:1,영웅:1.5,적장:2.5,사또:3,부인:1,이날:0.8,중략:1,전:0.3,몽:1,설화:1.5,판소리:3,고전소설:3,본문:0.3,한림:3,재상:3,공이:1'),
  '극·수필': L('희곡:3,시나리오:3,대사:2.5,해설:2,무대:2,암전:3,조명:2,등장:1.5,퇴장:2,연출:2.5,인서트:3,지문:1.5,막:0.5,장면:0.6,수필:3,에세이:3,글쓴이:1,필자:0.8,체험:2,성찰:2,일상:1.5,깨달음:2.5,사색:2,회상:1,삶:0.8,극적:2,갈래:1.5,독자:0.5,카메라:1.2,S#:3,배우:2,관객:0.8,방송:1'),
  '화법과 작문': L('발표:2.5,토론:2.5,청중:3,진행자:2.5,사회자:3,학생의초고:4,초고:3,글쓰기계획:4,대화:1.2,면담:2.5,강연:2.5,말하기방식:4,발화:1,인터뷰:2,기사문:2.5,건의문:3,독자:1.5,고쳐쓰:3,수정:0.8,학생회:2.5,동아리:2.5,발표자료:4,쓰기:1.5,작문:3,화법:3,글의구성:3,반영:1,토의:3,협상:2.5,연설:3,교지:3,보도자료:3,홍보:1.5,설문조사:2,자료활용:3,매체자료:1'),
  '언어와 매체': L('음운:3,형태소:3,품사:3,문장성분:3,탐구:1.5,중세국어:4,표준발음:3,매체:2.5,누리소통망:3,누리집:3,블로그:3,게시판:2.5,댓글:2.5,인터넷뉴스:3,모바일:1.5,단어:1,어미:2,조사:1.2,접사:3,어근:3,합성어:3.5,파생어:3.5,높임:2,피동:3,사동:3,활용:1.5,용언:3,체언:3,자음:2.5,모음:2.5,받침:2.5,탈락:2.5,된소리:3,구개음화:3.5,비음화:3.5,학습활동:3.5,SNS:2.5,웹툰:2.5,쇼츠:2.5,문법:1.5,담화:1.5,관형어:3,부사어:3,서술어:2.5,안은문장:3.5,이어진문장:3.5,시제:2,종결어미:3.5,선어말어미:3.5,훈민정음:3'),
};

const ARCHAIC_VERSE = /(하노라|노라|로다|도다|하여라|하리라|노니|하니라|이시랴|엇더|어이|아니하|하노|ᄒ|ᄇ|호노라|호야|이다마는|하난|하랴)/g;
const ARCHAIC_PROSE = /(하더라|이르되|아뢰|하옵|소저|낭자|분부|사이다|나이다|하오니|하시니|하거늘|일렀다|하매|더라[.,\s])/g;

export function normalizeCompact(s) {
  return String(s || '').replace(/\s+/g, '').replace(/[“”‘’「」『』〈〉《》]/g, '');
}

function countOcc(hay, needle) {
  if (!needle) return 0;
  let c = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { c++; i += needle.length; }
  return c;
}

function lexScore(compact, lex) {
  let score = 0;
  const hits = [];
  for (const [k, w] of lex) {
    const kk = k.replace(/\s+/g, '');
    const c = countOcc(compact, kk);
    if (c) {
      const v = w * (1 + Math.log(c));
      score += v;
      hits.push({ k, c, v });
    }
  }
  hits.sort((a, b) => b.v - a.v);
  return { score, hits };
}

function count(re, s) { return (s.match(re) || []).length; }

export function textFeatures(bodyLines, qLines = []) {
  const lines = bodyLines.map((l) => l.trim()).filter(Boolean);
  const n = lines.length;
  const body = lines.join('\n');
  const chars = body.replace(/\s/g, '').length || 1;
  const lens = lines.map((l) => l.length);
  const avg = n ? lens.reduce((a, b) => a + b, 0) / n : 0;
  const shortRatio = n ? lens.filter((x) => x <= 24).length / n : 0;
  const periodRatio = n ? lines.filter((l) => /[.?!]["”’)」]?\s*$/.test(l)).length / n : 0;
  const quotes = count(/[“”"「」『』]/g, body) / 2;
  const past = count(/(았|었|였|했|렸|겼|졌|랐|왔|갔|셨|봤|됐)다[.”"’]?/g, body);
  const pastPer1000 = (past / chars) * 1000;
  const first = count(/(?:^|[\s(])(나는|내가|나의|나도|나를|내게|저는|우리는)(?=[\s,.])/g, body);
  const speakers = lines.filter((l) => /^[가-힣A-Za-z0-9 ]{1,8}\s*[:：]\s*\S/.test(l)).length;
  const stageDir = lines.filter((l) => /^\s*[(（].{2,60}[)）]\s*$/.test(l)).length;
  const scene = count(/(S#\s*\d+|#\s*S\s*\d+|S\d+\.|장면\s*#\d+)/g, body);
  const archaicVerse = count(ARCHAIC_VERSE, body);
  const archaicProse = count(ARCHAIC_PROSE, body);
  const poemLike = n >= 6 && shortRatio >= 0.7 && periodRatio < 0.22 && avg < 26;
  return { n, chars, avg, shortRatio, periodRatio, quotes, pastPer1000, first, speakers, stageDir, scene, archaicVerse, archaicProse, poemLike };
}

const MIN = { reading: 6, lit: 7, select: 8 };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const r1 = (x) => Math.round(x * 10) / 10;

/**
 * 지문 하나를 분류한다.
 * @param {{bodyLines:string[], qLines?:string[], section?:string|null, heading?:string}} p
 * @returns {{tags:{label:string,score:number}[], primary:string|null, confidence:number, status:'auto'|'needs-manual', evidence:Object<string,string[]>, method:string}}
 */
export function classifyPassage(p) {
  const bodyLines = p.bodyLines || [];
  const qLines = p.qLines || [];
  const body = normalizeCompact(bodyLines.join('') + (p.heading || ''));
  const q = normalizeCompact(qLines.join(''));
  const f = textFeatures(bodyLines, qLines);
  const scores = {};
  const hitsBy = {};
  const struct = {};

  for (const cat of Object.keys(LEX)) {
    const b = lexScore(body, LEX[cat]);
    const qq = lexScore(q, LEX[cat]);
    const qW = READING.includes(cat) ? 0.3 : 0.9;
    scores[cat] = b.score + qq.score * qW;
    hitsBy[cat] = [...b.hits, ...qq.hits.map((h) => ({ ...h, q: true }))].sort((a, c) => c.v - a.v);
    struct[cat] = [];
  }

  const add = (cat, v, why) => { scores[cat] += v; struct[cat].push(why); };

  // --- 구조 신호 ---
  if (f.poemLike) {
    add('현대시', 6, `짧은 행 구조(행 평균 ${Math.round(f.avg)}자, 마침표 종결 ${Math.round(f.periodRatio * 100)}%)`);
    if (f.archaicVerse >= 2) { add('고전시가', 6, `예스러운 종결 표현 ${f.archaicVerse}회 + 행 구조`); scores['현대시'] -= 3; }
  }
  if (!f.poemLike && f.archaicVerse >= 4 && f.n >= 3 && f.avg < 40) add('고전시가', 3, `예스러운 종결 표현 ${f.archaicVerse}회`);
  if (f.pastPer1000 >= 6) add('현대소설', 4, `과거형 서술 종결 ${r1(f.pastPer1000)}회/1000자`);
  if (f.quotes >= 4) add('현대소설', 3, `따옴표 대사 ${Math.round(f.quotes)}회`);
  if (f.archaicProse >= 3) {
    add('고전소설', 6, `고전 서술 어투 ${f.archaicProse}회`);
    scores['현대소설'] *= 0.5;
  }
  if (f.speakers >= 4) add('극·수필', 5, `'인물: 대사' 형식 ${f.speakers}줄`);
  if (f.stageDir >= 3) add('극·수필', 3, `괄호 지시문 ${f.stageDir}줄`);
  if (f.scene >= 1) add('극·수필', 4, `장면 표기 ${f.scene}회`);
  if (f.first >= 6 && f.quotes < 3 && f.speakers < 3) add('극·수필', 3, `1인칭 서술 ${f.first}회, 대화 적음`);
  if (f.speakers >= 4 && /(학생|사회자|진행자|청중|발표자|토론자)/.test(bodyLines.join(''))) add('화법과 작문', 4, "대화·토론 형식(발표자/사회자 등)");
  if (/\[?학생의 ?초고\]?|\[?초고\]?/.test(bodyLines.join(' '))) add('화법과 작문', 4, "'초고' 표지");
  if (/학습 활동|\[?탐구 (과제|활동)\]?|\[?자료\]?/.test(bodyLines.join(' ')) && scores['언어와 매체'] > 3) add('언어와 매체', 2, "탐구 활동/자료 표지");
  if (/\[?앞부분의 ?줄거리\]?/.test(bodyLines.join(' '))) add('현대소설', 4, "'앞부분의 줄거리' 표지");

  // 구간 힌트(문서 내 '화법과 작문' / '언어와 매체' 머리말)
  if (p.section === '화법과 작문') add('화법과 작문', 8, "문서 구간 머리말: 화법과 작문");
  if (p.section === '언어와 매체') add('언어와 매체', 8, "문서 구간 머리말: 언어와 매체");

  // 비문학과 문학의 충돌 완화: 문학 구조 신호가 강하면 비문학 어휘 점수를 줄인다.
  const litStrong = Math.max(...LITERATURE.map((c) => scores[c]));
  const readStrongTop = Math.max(...READING.map((c) => scores[c]));
  if (litStrong > 14 && litStrong > readStrongTop * 0.9) for (const c of READING) scores[c] *= 0.6;

  // --- 후보 선택 ---
  const groupOf = (c) => (READING.includes(c) ? 'reading' : LITERATURE.includes(c) ? 'lit' : 'select');
  const ranked = Object.keys(LEX)
    .map((c) => ({ c, s: scores[c], g: groupOf(c) }))
    .sort((a, b) => b.s - a.s);
  const top = ranked[0];
  const passes = (x) => x.s >= MIN[x.g];

  const evidence = {};
  const tags = [];
  if (!passes(top)) {
    return { tags: [], primary: null, confidence: 0, status: 'needs-manual', evidence: { '미분류': [`뚜렷한 근거 부족(최고 ${top.c} ${r1(top.s)}점 < 기준 ${MIN[top.g]}점). 수동 분류가 필요합니다`] }, method: 'rule-v1', stats: brief(f) };
  }
  for (const x of ranked) {
    if (!passes(x)) continue;
    if (x.c === top.c || x.s >= top.s * 0.6) tags.push({ label: x.c, score: r1(x.s) });
  }
  // 융합: 서로 다른 비문학 영역이 모두 강할 때
  const readTags = tags.filter((t) => READING.includes(t.label));
  if (readTags.length >= 2) tags.unshift({ label: '융합', score: r1(readTags.reduce((a, t) => a + t.score, 0) / readTags.length) });

  for (const t of tags) {
    const ev = [];
    if (t.label === '융합') ev.push(`복수 영역이 함께 강함: ${readTags.map((x) => x.label).join(' + ')}`);
    else {
      const hits = hitsBy[t.label].slice(0, 6).map((h) => `${h.k}×${h.c}${h.q ? '(문항)' : ''}`);
      if (hits.length) ev.push(`핵심어: ${hits.join(', ')}`);
      ev.push(...struct[t.label]);
      ev.push(`점수 ${t.score}`);
    }
    evidence[t.label] = ev;
  }
  const second = ranked.find((x) => x.c !== top.c);
  const margin = second ? (top.s - second.s) / (top.s + 1) : 1;
  const confidence = Math.round(clamp01(margin * 0.6 + clamp01(top.s / 25) * 0.4) * 100) / 100;
  return { tags, primary: tags[0].label, confidence, status: 'auto', evidence, method: 'rule-v1', stats: brief(f) };
}

function brief(f) {
  return { lines: f.n, avgLen: Math.round(f.avg), periodRatio: Math.round(f.periodRatio * 100) / 100, quotes: Math.round(f.quotes), pastPer1000: r1(f.pastPer1000) };
}

export function confidenceLabel(c) {
  return c >= 0.65 ? '높음' : c >= 0.4 ? '보통' : '낮음';
}
