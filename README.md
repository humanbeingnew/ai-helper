# STUDY HUB PRO · RSS ONLY V9

학생용 학습 플랫폼입니다. 자료 검색 엔진을 RSS 피드 전용 구조로 유지하면서, V7/V8에서 확인된 제공처 HTTP 503 진단 부족과 검색 요청 경쟁 상태를 개선했습니다.

## 1. 검색 구조

| 화면 | RSS 제공처 | 수집 방식 |
|---|---|---|
| 뉴스 | Google News RSS | 검색어별 RSS 2.0 피드 |
| 사진 | Flickr 공개 사진 RSS | 태그 RSS 2.0, 이미지 메타데이터가 있는 사진만 표시 |
| 학술자료 | arXiv RSS | 공식 주제 카테고리 RSS 2.0 피드 |

외부 자료 수집은 RSS만 사용합니다. 일반 검색 API, JSON 검색 API, 기사 웹페이지 크롤링으로 전환하지 않습니다. RSS 제공처 오류가 발생하면 그 오류를 표시하고 다른 검색 방식으로 대체하지 않습니다.

## 2. V9에서 수정한 내용

- Google News RSS 요청에 한국어 `Accept-Language`와 RSS/XML 중심 `Accept` 헤더를 사용합니다. 크롤러 위장 User-Agent는 사용하지 않습니다.
- 제공처의 일시적 HTTP 408/425/429/5xx 응답에 한해 동일 RSS 주소를 최대 1회 재시도합니다. 단, Google의 HTML 응답에 자동 요청/접근 제한 문구가 확인되면 재시도를 중지합니다. 다른 제공처 또는 검색 방식으로 바꾸지 않습니다.
- `Retry-After` 초 단위 값과 HTTP 날짜 형식을 모두 해석합니다.
- Google News 503 응답에서 접근 제한 징후, 응답 형식, 선언된 크기, 본문 요약을 구분해 화면에 표시합니다. 본문이 없거나 일반적인 503이면 원인을 단정하지 않습니다.
- 성공한 피드 응답은 Worker 인스턴스 내부에서 최대 90초 동안 재사용하고, 같은 시점의 동일 요청은 하나의 upstream 요청을 공유합니다. 인스턴스가 바뀌면 이 캐시는 공유되지 않는 최적화입니다.
- 오류 응답에 `upstreamStatus`, `failureKind`, 제공처 응답 요약을 포함합니다. 화면에서 Worker의 502와 RSS 제공처의 503을 구분합니다.
- RSS 최대 크기를 5MB로 제한합니다. 리디렉션은 자동으로 따라가지 않고 목적지 호스트를 먼저 검사하며, 승인된 동일 RSS 호스트 안에서만 최대 2회 따라갑니다. 외부 호스트·HTTP·다른 포트로 이동하면 차단합니다.
- 검색어 200자 제한, 비정상 URL 차단, 중복 URL/제목 제거를 적용했습니다. 200자를 넘으면 조용히 자르지 않고 400 오류로 알려줍니다.
- 검색 화면의 타임아웃을 35초로 맞춰 Worker의 2회 시도(각각 최대 11~15초)가 브라우저에서 먼저 취소되지 않도록 조정했습니다.
- 정적 파일 `ASSETS` 바인딩이 누락된 경우 런타임 예외 대신 원인을 설명하는 JSON 503을 반환합니다. health 경로도 GET만 허용합니다.
- 검색을 빠르게 연속 실행할 때 이전 요청의 타임아웃이 새 요청을 취소할 수 있던 프런트엔드 경쟁 상태를 수정했습니다.
- 학술 RSS의 날짜·저자·권리 정보 필드 파싱을 보강하고, 잘못된 arXiv 카테고리 구성을 일부 바로잡았습니다.

## 3. 503 오류의 해석

검색 화면에 `Google News RSS HTTP 503`이 표시되면 Google News가 Worker의 요청에 503을 반환했다는 뜻입니다. `/api/search`의 HTTP 502는 Worker가 upstream 오류를 앱에 전달하기 위해 사용한 상태 코드입니다.

HTTP 503만으로 Google의 차단, 일시 장애, 과도한 요청 중 어느 원인인지 확정할 수는 없습니다. 최근에는 Google News RSS가 Cloudflare Worker에서 503을 반환하고 일반 PC에서는 200을 반환한 사례가 공개됐으며, 서버 IP 평판 제한 가능성이 분석됐습니다. V9는 제공처 본문에 자동 요청/접근 제한 문구가 있으면 별도 오류로 표시하고 불필요한 재시도를 중단합니다. 그 문구가 없으면 원인을 단정하지 않습니다. 오류 화면에는 RSS 원본 주소를 새 탭에서 열 수 있는 진단 링크도 표시합니다. Worker 실행 IP가 실제 제한 대상이라면 코드의 헤더 변경이나 재시도만으로 해제할 수 없습니다. 이 경우에도 JSON API, HTML 크롤링, 다른 검색 방식으로 우회하지 않습니다.

## 4. 검색 API 확인

배포 주소를 `YOUR-WORKER`로 바꿔 사용합니다.

```text
GET https://YOUR-WORKER.workers.dev/api/health
GET https://YOUR-WORKER.workers.dev/api/search?type=news&q=인공지능
GET https://YOUR-WORKER.workers.dev/api/search?type=photos&q=로봇
GET https://YOUR-WORKER.workers.dev/api/search?type=academic&q=인공지능
```

`/api/health`는 버전, RSS 전용 설정, 세 제공처를 반환합니다. 실제 연결 상태를 확인하려면 검색 API를 각 유형별로 호출해야 합니다.

오류 응답 예시:

```json
{
  "error": "RSS 제공처 응답 오류 (HTTP 503)",
  "failureKind": "upstream_http_error",
  "upstreamStatus": 503,
  "retryable": true,
  "provider": "Google News RSS"
}
```

## 5. 배포

이 프로젝트는 Cloudflare Workers + Static Assets 방식입니다.

```bash
npm install
npm run dev
npm run deploy
```

GitHub에는 이 ZIP의 프로젝트 파일만 업로드하면 됩니다. 검증 코드와 테스트 결과는 별도 테스트 ZIP으로 분리했습니다.

## 6. 범위와 한계

- Google News RSS는 Google News가 색인한 뉴스 범위에 한정됩니다. 피드 형식과 접근 정책은 Google이 변경할 수 있습니다.
- Flickr 사진마다 라이선스가 다릅니다. 사용 전에 원문 페이지에서 권리 조건을 확인해야 합니다.
- arXiv 검색은 선택된 주제 카테고리의 새 발표/갱신 RSS 범위에 한정됩니다. 전체 학술 데이터베이스를 검색하지 않습니다.
- RSS 제공처의 503, 429, 네트워크 장애는 앱 코드만으로 항상 해결할 수 없습니다.
- 이 작업 환경에서는 DNS/외부 네트워크가 차단되어 실제 Google/Flickr/arXiv에 대한 실시간 요청은 수행하지 못했습니다. 모의 RSS 테스트, 구문 검사, API 경로 검사를 검증했습니다. 따라서 이 수정본은 503의 진단과 불필요한 재요청을 개선하지만, 제공처가 Worker IP를 차단한 경우 결과가 자동으로 200으로 바뀐다고 보장하지 않습니다.

## 7. 데이터 처리

검색어는 선택한 RSS 제공처에 전달되기 위해 Cloudflare Worker를 통과합니다. 학습 피드백 내용은 검색 API에 전달하지 않으며 브라우저 안에서 처리합니다. 학습 기록은 브라우저 `localStorage`에 저장됩니다.
