# STUDY HUB PRO

학생을 위한 무료 우선 학습 웹앱입니다. GitHub 저장소에 올린 뒤 Cloudflare Pages와 연결하는 배포 구성을 사용합니다.

## 기능
- 자료 탐색: OpenAlex 공개 학술 메타데이터 + 한국어 Wikipedia 개요 검색
- AI 피드백: Gemini 2.5 Flash API 연결 시 글의 강점, 개선점, 짧은 수정 예시 제공
- AI 키 미설정 시: 기본 글쓰기 점검표로 동작 (생성형 AI가 아니며 화면에 구분 표시)
- 학습 기록: 브라우저 localStorage에 최근 40건 저장
- PC / 태블릿 / 모바일 반응형 UI

## 1. GitHub 업로드
1. 압축을 풀고 `study-hub-pro` 폴더 안의 파일과 폴더를 GitHub 저장소에 업로드합니다.
2. 저장소 최상단에 `public`, `functions`, `README.md`가 보여야 합니다.

## 2. Cloudflare Pages 배포
1. Cloudflare 대시보드에서 **Workers & Pages → Create → Pages → Connect to Git**을 선택합니다.
2. GitHub 저장소를 연결합니다.
3. 빌드 설정은 다음과 같이 입력합니다.
   - Framework preset: `None`
   - Build command: 비워 둠
   - Build output directory: `public`
   - Root directory: `/` (저장소 최상단)
4. 저장하고 배포합니다. `functions` 폴더는 `public`과 같은 저장소 최상단에 있어야 Pages Functions로 인식됩니다.

## 3. 실제 AI 피드백 연결 (무료 사용량 범위)
AI 피드백을 실제 생성형 AI로 사용하려면 Google AI Studio에서 Gemini API 키를 발급하고 Cloudflare Pages 프로젝트에 비밀 환경 변수로 등록합니다.

1. https://aistudio.google.com/app/apikey 에서 API 키를 만듭니다.
2. Cloudflare Pages 프로젝트 → Settings → Variables and Secrets로 이동합니다.
3. Functions 환경 변수에 `GEMINI_API_KEY`라는 이름으로 키를 등록하고 **Secret**으로 저장합니다.
4. 새 배포를 실행합니다.

Gemini API에는 무료 등급과 사용량 제한이 있습니다. 무료 등급의 모델·요청 한도는 변경될 수 있으며, 한도 초과 시 AI 요청이 잠시 실패할 수 있습니다. 유료 과금이 자동으로 시작되지 않도록 Google AI Studio의 프로젝트 결제 설정을 직접 확인하세요. API 키를 HTML, JavaScript, GitHub 코드에 직접 넣지 마세요.

AI 피드백을 설정하지 않아도 사이트와 자료 탐색은 사용할 수 있습니다. 키 미설정 상태의 피드백은 기본 점검표이며 AI 분석이 아닙니다.

## 4. 로컬 미리보기
정적 화면만 확인하려면 `public/index.html`을 브라우저에서 열 수 있습니다. API 검색과 Functions는 Cloudflare Pages 배포 환경에서 확인하세요. 로컬에서 전체 API를 시험하려면 Node.js와 Wrangler가 필요합니다.

## 데이터와 개인정보
- 학습 기록은 사용 중인 브라우저의 localStorage에 저장됩니다.
- 피드백 입력은 Cloudflare Function을 통해 Gemini API로 전송됩니다.
- 민감한 개인정보, 비밀번호, 학교 계정 정보는 과제 내용에 붙여 넣지 마세요.
- 자료 검색 결과는 참고용입니다. 원문과 출처의 정확성·신뢰성은 직접 확인해야 합니다.

## 프로젝트 구조
```
public/
  index.html
  styles.css
  app.js
functions/
  api/
    search.js
    feedback.js
README.md
tests/                 # 배포 폴더에 포함하지 않는 검증 기록
```
