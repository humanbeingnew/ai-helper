# STUDY HUB PRO · RSS 검색 버전

학생을 위한 무료 학습 자료 탐색 및 자동 피드백 웹앱입니다.

## 이번 변경: 네이버 API 키 없이 RSS로 뉴스/블로그 검색

- 네이버 Client ID / Client Secret을 더 이상 사용하지 않습니다.
- Google News RSS 검색에서 `site:news.naver.com` 결과를 별도 수집해 네이버 뉴스 영역으로 표시합니다.
- `site:blog.naver.com` 결과를 별도 수집해 네이버 블로그/칼럼 영역으로 표시합니다.
- 일반 Google News RSS도 함께 검색합니다.
- RSS 피드는 검색어와 날짜 조건을 포함하며, 뉴스는 최근 30일, 블로그/칼럼은 최근 90일 결과만 후보로 사용합니다.
- RSS 제공처가 실패해도 OpenAlex/Wikipedia/다른 RSS 결과는 가능한 범위에서 표시합니다.

### RSS 방식의 중요한 한계

Google News RSS는 Google이 공개한 검색 API가 아니라 RSS 피드 형식으로 널리 사용되는 기능이며, 공식 SLA가 없습니다. 검색 결과는 Google News가 색인한 콘텐츠에 한정되므로 네이버 검색창의 전체 결과와 동일하지 않습니다. 네이버 블로그/칼럼도 Google News에 색인된 공개 게시물만 잡힐 수 있으며, 모든 블로그 글이 보장되지는 않습니다. 피드 구조나 접근 정책이 바뀌면 수집이 중단될 수 있습니다.

네이버 블로그 자체 RSS는 보통 개별 블로그의 피드 주소를 구독하는 방식이므로 임의의 검색어 전체를 검색하는 피드로 취급하지 않습니다. 네이버도 RSS를 최신 글을 담는 XML 피드로 설명합니다.

## 검색 품질 및 최신성

- 제목과 설명에 검색어 핵심 단어가 포함되는지 점수화합니다.
- 관련도가 낮은 결과를 제외하고 같은 제목은 중복 제거합니다.
- 뉴스/네이버 뉴스는 최근 30일, 네이버 블로그/칼럼은 최근 90일을 우선 필터링합니다.
- OpenAlex는 최근 3년 학술자료와 관련도 검색을 함께 가져와 재정렬합니다.
- Wikipedia는 최신 자료가 아니라 배경 자료로 표시하며 마지막 수정일을 발행일처럼 표시하지 않습니다.

## 무료 운영

검색 경로에는 네이버 API 키, 유료 검색 API, OpenAI API 키가 필요하지 않습니다. Cloudflare Workers 무료 플랜의 사용량 한도와 외부 RSS 제공처의 정책/가용성은 별도로 적용됩니다.

## 확인

```text
https://YOUR-WORKER.workers.dev/api/health
https://YOUR-WORKER.workers.dev/api/search?q=인공지능%20교육
```

`/api/health`에서 `naverRssEnabled: true`, `naverApiKeyRequired: false`를 확인할 수 있습니다. 검색 응답의 `providers`에는 성공한 RSS 제공처가 표시됩니다.

## 프로젝트 구조

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

## 배포

```bash
npm install
npm run deploy
```

Cloudflare 대시보드에서 GitHub 저장소를 연결하는 경우 프로젝트 루트에 `wrangler.toml`이 있도록 설정합니다.

## 개인정보

학습 피드백 입력 내용은 서버 검색 API로 보내지 않고 브라우저 안에서 분석합니다. 검색어는 검색을 위해 Worker와 외부 자료 제공처로 전달됩니다. 검색 기록과 피드백 활동명은 현재 브라우저의 localStorage에 저장됩니다.


## 검색 속도 개선 (v2.5.0)
- Google News RSS의 네이버 뉴스/블로그 검색 순차 재시도 제거: 피드당 1회 요청
- RSS 요청 타임아웃 4.5초, OpenAlex 5초, Wikipedia 4초, 이미지 보완 2.5초
- 외부 제공처 병렬 요청 유지
- 검색 응답 캐시 60초 + stale-while-revalidate 120초
- 브라우저 검색 타임아웃 9초
- 이미지 조회는 보조 기능이며 실패해도 검색 결과에 영향 없음


## v4.0 검색 아키텍처
- Google News RSS + Bing News RSS를 독립 공급원으로 사용
- 네이버 뉴스/블로그는 RSS 색인 결과를 실제 링크 도메인으로 검증
- 관련도 점수가 낮은 결과는 제거하고 최신성은 별도 점수로 반영
- 같은 URL/제목 중복 제거
- 한 공급처가 결과를 독점하지 않도록 자료 유형별 균형 선택
- Wikipedia는 정상 검색 결과가 아니라 **fallback-only**
- 공급처별 실패는 전체 검색 실패로 전파하지 않고 `providerWarnings`에 기록
- 네이버 API 키 불필요
- 뉴스 30일, 네이버 뉴스 90일, 네이버 블로그 180일, 학술자료 5년을 기본 범위로 사용
- 이미지 보완은 검색 결과 이후 별도 기능으로 유지 가능


## v5.0 검색 안정화
- Wikipedia를 일반 검색 결과에서 완전히 제외
- RSS publisher URL을 보존해 네이버 뉴스/블로그 판별 정확도 개선
- Bing Web RSS 의존 제거
- 관련도 필터를 한국어 단어 단위로 완화하되 다단어 검색은 제목 핵심어 포함을 요구
- providerWarnings를 화면 상태에도 표시
