# STUDY HUB PRO · Cloudflare Workers 버전

학생을 위한 무료 학습 자료 탐색 및 자동 피드백 웹앱입니다.

## 이번 수정
- Cloudflare Pages 전용 `functions/api/search.js` 제거
- Cloudflare Workers 진입점 `src/index.js` 추가
- `/api/search` 요청을 Worker에서 직접 처리
- 기존 OpenAlex + 한국어 Wikipedia 검색 제공처 유지
- 검색 응답이 JSON이 아닐 때 화면이 그대로 깨지지 않도록 오류 처리 개선
- 정적 화면은 `public/`에서 Worker Assets로 제공
- Gemini 등 생성형 AI API 키 불필요

## GitHub 업로드
압축을 풀고 폴더 안의 파일과 폴더를 GitHub 저장소 최상단에 업로드하세요.

필수 구조:
```text
public/
  index.html
  styles.css
  app.js
src/
  index.js
package.json
wrangler.toml
README.md
```

기존 `functions/` 폴더는 더 이상 필요하지 않습니다.

## Cloudflare Workers 배포
1. Cloudflare 대시보드에서 **Workers & Pages**로 이동합니다.
2. **Create application** 또는 **Create**를 누릅니다.
3. **Workers**에서 GitHub 저장소 연결(Connect to Git)을 선택합니다.
4. 이 저장소를 선택합니다.
5. 빌드/배포 설정은 다음과 같이 입력합니다.
   - Root directory: `/`
   - Build command: `npm install`
   - Deploy command: `npm run deploy`
6. 저장 후 배포합니다.

Cloudflare 화면에서 Build command와 Deploy command를 한 칸으로만 받는 경우에는 `npm install && npm run deploy`를 사용하세요.

## 로컬 테스트(선택)
Node.js가 설치된 컴퓨터에서 프로젝트 폴더를 열고:
```bash
npm install
npm run dev
```
로컬 주소에서 화면을 확인하고 `/api/search?q=해킹`을 테스트할 수 있습니다.

## 기능과 API 안내
- 자료 검색: Worker가 OpenAlex와 한국어 Wikipedia의 공개 API에 요청합니다.
- 학습 피드백: 브라우저 안에서 실행되는 규칙 기반 자동 점검입니다. 생성형 AI가 아니며, 사실 여부를 원문과 대조해 확정하지 않습니다.
- Gemini API 키, 결제용 AI API 키, 별도 비밀키는 필요하지 않습니다.

## 개인정보
과제 글은 브라우저 안에서 분석되며 검색 API로 전송되지 않습니다. 검색어는 자료 검색을 위해 Worker와 공개 자료 제공처로 전달됩니다. 학습 기록은 브라우저 localStorage에 저장됩니다.
