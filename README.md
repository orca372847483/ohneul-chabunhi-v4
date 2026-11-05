# 오늘도 차분히 · 국어 기출 라이브러리 v4

아이패드에서 GitHub 웹사이트로 올리고 Netlify로 배포하는 정적 웹앱입니다. 빌드 과정이 없습니다.

## 폴더 구조 (올릴 때 이 모양 그대로)
```
README.md
netlify.toml
package.json
netlify/functions/   (서버 기능 5개 + lib/ 4개)
public/
  index.html  manifest.webmanifest  sw.js
  css/  js/  icons/
  vendor/pdfjs/      (PDF 엔진: cmaps, standard_fonts, wasm, iccs 포함)
```
`public/public` 같은 중복 폴더는 없습니다. 숨김 파일(.으로 시작하는 파일)·.git·node_modules·.env 도 없습니다.

## GitHub에 올리기 (아이패드)
1. 받은 ZIP 을 파일 앱에서 길게 눌러 "압축 풀기".
2. github.com → 새 저장소(New) → 이름 입력 → Create repository.
3. "uploading an existing file" 링크를 누르고, **풀린 폴더 안의 항목들**(README.md, netlify.toml, package.json, netlify, public)을 한 번에 끌어다 놓거나 "choose your files"로 선택.
   - 한 번에 파일이 100개 넘으면 실패할 수 있어요. 이 프로젝트는 약 90개라 한 번에 가능합니다. 안 되면 먼저 public 이외 항목, 그다음 public 을 올리세요.
4. 맨 아래 Commit changes 를 누릅니다.
5. 올라간 뒤 저장소 화면에서 `public/index.html`, `public/js/app.js`, `netlify/functions/sync.mjs` 가 보이면 정상입니다.

## Netlify 배포
1. app.netlify.com → Add new site → Import an existing project → GitHub → 방금 만든 저장소 선택.
2. 설정은 그대로 두세요(netlify.toml 이 자동 적용: Publish directory = public, Functions = netlify/functions). Deploy 를 누릅니다.
3. 1~2분 뒤 나오는 주소(예: xxxx.netlify.app)를 사파리로 열고 공유 버튼 → "홈 화면에 추가".
4. (선택) Site configuration → Environment variables:
   - `SYNC_ACCESS_CODE` : 동기화에 접근 코드를 요구하려면 아무 글자 입력
   - `SOURCES_JSON` : 자동 수집 출처 주소를 바꿀 때
   - `EXTRA_ALLOWED_HOSTS` : 수집을 허용할 추가 도메인
   API 키는 코드에 넣지 않고 반드시 여기에만 입력하세요.

## v3 데이터 가져오기
- v3 를 쓰던 **같은 브라우저, 같은 주소**에서 v4 를 열면 자동으로 가져옵니다(v3 원본은 지우지 않습니다).
- 주소가 다르면: v3에서 백업을 내보낸 뒤, v4 설정 ▸ "백업 불러오기". 같은 주소인데 자동으로 안 됐다면 설정 ▸ "v3 데이터 다시 가져오기".

## 백업
설정 ▸ 백업 내보내기(파일 앱에 저장), 설정 ▸ 백업 불러오기. 정기적으로 받아 두세요.

## 아직 실제 기기에서 확인 못 한 것 (정직하게)
- 실제 평가원·EBSi 사이트 자동 수집: 개발 환경에서 외부 접속이 막혀 시험하지 못했습니다. 기본 주소는 "후보"입니다. 실패하면 앱의 "연결 진단"에 원인(DNS/접근 제한/주소 변경 등)이 표시되며, PDF 직접 추가는 항상 가능합니다.
- 실제 아이패드 사파리·Apple Pencil 필압/손바닥 무시, 홈 화면 앱, Netlify 서버 기능(동기화) 실배포, OCR(외부 CDN 로드).
- 자동 시험(Chromium 에뮬레이션)에서는 36개 항목 모두 통과: 아이패드 가로/세로, 아이폰 크기 포함.
