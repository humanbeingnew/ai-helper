# STUDY HUB PRO · Cloudflare Workers 버전

학생을 위한 무료 학습 자료 탐색 및 자동 피드백 웹앱입니다.

## 최종 점검본

이번 버전은 기존 기능을 유지하면서 다음 문제를 추가로 보완했습니다.

- `/api/search`를 Cloudflare Worker에서 직접 처리
- OpenAlex + 한국어 Wikipedia를 병렬 검색
- 한 제공처가 실패해도 다른 제공처가 성공하면 결과 표시
- 외부 API별 10초 서버 타임아웃
- 검색어 2자 미만 입력을 서버/클라이언트에서 차단
- OpenAlex의 `select` 파라미터 의존 제거
- 외부 API 요청에 User-Agent 추가
- `/api/health` 상태 확인 엔드포인트 추가
- 검색 화면의 JSON/HTTP 오류 처리 강화
- 브라우저 검색 요청에도 16초 타임아웃 추가
- 검색 중 중복 요청을 취소해 오래된 결과가 새 결과를 덮어쓰는 문제 방지
- 학습 기록 `localStorage`가 손상되거나 저장 한도를 초과해도 검색/피드백 자체는 실패하지 않도록 수정
- 주제 일치 분석의 영문 대소문자 처리 보완
- 로고 클릭 시 대시보드로 이동
- URL hash(`#home`, `#search`, `#feedback`, `#history`)로 화면 이동 지원
- 도움말 모달의 Esc 닫기 및 기본 접근성 속성 보완
- 검색 결과/피드백 기록은 최대 40개만 로컬 저장

## 무료 운영 구조

현재 애플리케이션은 별도의 유료 AI API 키를 요구하지 않습니다.

- 자료 검색: OpenAlex 공개 API + 한국어 Wikipedia API
- 학습 피드백: 브라우저에서 실행되는 규칙 기반 분석
- 학습 기록: 사용자 브라우저의 `localStorage`
- 서버: Cloudflare Workers 무료 플랜 범위에서 운영 가능

단, Cloudflare와 외부 공개 API에는 각각 서비스별 사용량/정책 한도가 있으므로 대규모 트래픽까지 무제한 무료라는 의미는 아닙니다.

## GitHub 업로드

압축을 풀고 폴더 안의 파일과 폴더를 GitHub 저장소 최상단에 업로드하세요.

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
5. 프로젝트 설정에서 `wrangler.toml`이 읽히도록 Root directory를 `/`로 둡니다.
6. Git 연동 화면에서 요구하는 Build/Deploy 설정에 맞춰 배포합니다. CLI를 사용하는 경우 아래 명령으로 배포할 수 있습니다.

```bash
npm install
npm run deploy
```

Cloudflare가 별도 Build command를 요구하는 경우 프로젝트의 실제 배포 방식에 맞춰 `npm install`을 사용하고, Deploy 단계에서는 `npm run deploy`를 실행하세요.

## 배포 후 확인

Worker 주소가 `https://YOUR-WORKER.workers.dev`라면 먼저:

```text
https://YOUR-WORKER.workers.dev/api/health
```

를 열어 `ok: true`가 반환되는지 확인하세요.

그 다음:

```text
https://YOUR-WORKER.workers.dev/api/search?q=해킹
```

를 열어 `providers`와 `results`가 포함된 JSON이 나오는지 확인하세요.

## 기능 안내

### 자료 탐색

Worker가 OpenAlex와 한국어 Wikipedia의 공개 API를 병렬 호출합니다. 한쪽만 일시적으로 실패해도 다른 쪽 결과가 있으면 검색 결과를 표시합니다.

### 학습 피드백

과제 글은 서버의 검색 API로 전송하지 않고 브라우저 안에서 규칙 기반으로 분석합니다. 생성형 AI가 아니며, 사실 여부를 원문과 대조해 확정하지 않습니다.

### 학습 기록

검색어와 피드백 활동명은 현재 브라우저의 `localStorage`에 최대 40개까지 저장됩니다. 서버 DB에는 저장하지 않습니다.

## 개인정보

피드백 입력 내용은 브라우저 안에서 분석됩니다. 검색어는 자료 검색을 위해 Worker와 공개 자료 제공처로 전달됩니다. 학습 기록은 현재 브라우저의 `localStorage`에 저장됩니다.
