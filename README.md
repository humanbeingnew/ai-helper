# STUDY HUB PRO · RSS ONLY V10

학생용 학습 플랫폼입니다. 자료 검색은 RSS/XML만 사용합니다. 뉴스는 Google News RSS를 최우선으로 요청하고, Google RSS가 연결되지 않거나 피드가 비어 있을 때만 국내 언론사의 공개 RSS를 보완 경로로 확인합니다.

## 1. 검색 구조

| 분야 | 우선 제공처 | 보완 제공처 | 방식 |
|---|---|---|---|
| 뉴스 | Google News RSS | 연합뉴스, 뉴시스, SBS 뉴스, MBN의 공식 공개 RSS | 전부 RSS/XML |
| 사진 | Flickr 공개 사진 RSS | 없음 | RSS/XML |
| 학술자료 | arXiv RSS | 없음 | RSS/XML |

뉴스 보완 경로는 Google News를 대체하는 일반 검색 API가 아닙니다. 공개된 언론사 RSS 피드의 최근 항목을 가져와 입력한 검색어가 제목 또는 요약에 포함된 항목만 표시합니다. 보완 결과에는 각 언론사 이름을 출처로 표시합니다.

일반 검색 API, JSON 검색 API, Google Images 검색, 기사 웹페이지 크롤링은 사용하지 않습니다. Google News RSS가 정상적으로 작동하면 언론사 보완 피드는 호출하지 않습니다.

## 2. V10의 핵심 변경

- Google News RSS를 뉴스 검색의 첫 번째이자 기본 제공처로 유지합니다.
- Google News가 HTTP 503/접근 제한/기타 RSS 오류를 반환하면 공식 언론사 RSS 4곳을 병렬로 확인합니다.
- Google News RSS가 정상 응답했지만 항목이 비어 있는 경우에도 보완 RSS를 확인합니다.
- 보완 피드: `https://www.yna.co.kr/rss/news.xml`, `https://www.newsis.com/RSS/sokbo.xml`, `https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER`, `https://www.mbn.co.kr/rss/`.
- 보완 피드도 RSS 2.0/XML로 파싱하고, 검색어와 일치하는 제목·요약만 표시합니다. 일치하지 않는 최신 기사로 결과를 채우지 않습니다.
- 검색 결과마다 언론사 출처를 표시하고, 상태 문구에 Google RSS가 실패해 보완 RSS를 사용했는지 알립니다.
- 보완 RSS까지 모두 실패하면 Google의 원인과 언론사별 실패 상태를 함께 반환합니다.
- 검색 화면 타임아웃을 65초로 설정해 Google 우선 요청 뒤 여러 보완 RSS를 병렬 확인하는 시간을 확보했습니다.
- 기존 사진(Flickr)과 학술자료(arXiv) 검색 경로는 변경하지 않았습니다.
- HTTPS 호스트 allowlist와 수동 리디렉션 검사를 유지합니다. RSS 피드가 승인되지 않은 도메인으로 이동하면 중단합니다.
- 검색어 길이 제한, 5MB 피드 크기 제한, 성공 피드 90초 캐시, in-flight 요청 공유, bounded retry를 유지합니다.

## 3. Google News 503 문제의 원인

Google News 검색 RSS URL 형식은 `https://news.google.com/rss/search?q=...&hl=ko&gl=KR&ceid=KR:ko`입니다. 이 형식은 현재도 사용되는 한국어 에디션 형식입니다.

최근 공개된 2026-11-05 기술 보고서에는 동일한 Google News RSS 주소가 일반 PC에서는 HTTP 200을 반환하지만 일부 Cloudflare Worker 서버에서는 HTTP 503과 짧은 HTML 응답을 반환한 사례가 기록되어 있습니다. 서버 IP 평판에 따른 제한 가능성이 지목됐지만, 모든 503이 IP 차단을 뜻하는 것은 아닙니다.

따라서 V10은 Google News RSS 요청을 계속 우선하되, Google의 서버 측 응답이 실패하면 동일한 RSS 방식으로 언론사 원본 피드도 확인합니다. Google RSS 자체가 반드시 성공한다고 보장할 수는 없지만, 뉴스 화면이 Google의 503 하나 때문에 완전히 비어 있는 문제를 줄이는 구조입니다.

## 4. API

```text
GET https://YOUR-WORKER.workers.dev/api/health
GET https://YOUR-WORKER.workers.dev/api/search?type=news&q=인공지능
GET https://YOUR-WORKER.workers.dev/api/search?type=photos&q=로봇
GET https://YOUR-WORKER.workers.dev/api/search?type=academic&q=인공지능
```

`/api/health`는 버전, RSS 전용 설정, 뉴스 기본/보완 RSS 제공처를 반환합니다.

뉴스 검색 성공 응답에는 `newsFallbackUsed`, `newsFallbackReason`, `newsFallbackFeedsUsed` 필드가 포함됩니다. Google News RSS를 사용했으면 `newsFallbackUsed`가 `false`, 국내 언론사 RSS 보완 경로를 사용했으면 `true`입니다.

## 5. 배포

Cloudflare Workers + Static Assets 프로젝트입니다.

```bash
npm install
npm run dev
npm run deploy
```

GitHub에는 **배포 ZIP의 파일만** 업로드하세요. 테스트 코드와 QA 결과는 별도 ZIP 및 보고서로 분리했습니다.

## 6. 세 가지 설계 검토 관점

1. RSS 엔진 관점: Google News를 1순위로 유지하고 응답이 정상이라면 보완 피드를 호출하지 않는 구조를 선택했습니다.
2. 검색 품질 관점: 보완 피드의 전체 최신 기사를 무조건 노출하면 검색어와 무관한 뉴스가 섞입니다. 그래서 제목·요약에 검색어가 포함된 항목만 반환하도록 했습니다.
3. 보안·운영 관점: 사용자가 입력한 URL은 받지 않고 코드에 고정된 HTTPS RSS 주소만 호출합니다. 허용 호스트와 리디렉션을 검사하며, RSS 이외의 API나 크롤링은 추가하지 않았습니다.

최종 결론: Google News RSS 우선 + 검증된 국내 언론사 RSS 보완, RSS/XML 전용, 보완 여부와 출처를 화면에 공개합니다.

## 7. 한계 및 검증 범위

- 언론사 보완 RSS는 각 언론사가 최근 발행한 피드 항목 범위에 한정됩니다. Google News처럼 전체 뉴스 인덱스를 대상으로 하는 검색은 아닙니다.
- 피드마다 최신 항목 수와 갱신 주기가 다릅니다. 따라서 보완 경로에서 오래된 기사나 검색어가 본문에만 등장하는 기사는 표시되지 않을 수 있습니다.
- 각 언론사 RSS는 해당 언론사의 이용 조건과 콘텐츠 권리를 따릅니다.
- 이 작업 환경은 외부 DNS/네트워크에 연결되지 않아 Cloudflare 실제 egress에서 실시간 피드 접근을 검증하지 못했습니다. Node.js 자동 테스트는 모의 RSS 응답으로 수행했습니다. 배포 후 `/api/search?type=news&q=해킹`을 실제 확인해야 합니다.
