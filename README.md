# STUDY HUB PRO V11.2

학생용 자료 탐색 및 과제 점검 웹앱입니다. 배포 대상은 **Cloudflare Workers + Static Assets**입니다.

## V11.2 변경 사항

- 뉴스 검색은 Google News와 연합뉴스·뉴시스·SBS·MBN 공개 RSS를 **동시에 조회**하고 결과를 합친 뒤 URL/제목 중복을 제거합니다. 이전의 Google 우선 → 실패 후 보완 RSS 순차 대기를 없애 검색 대기 시간을 줄였습니다.
- 뉴스 RSS 요청은 5~6초 timeout, 재시도 없는 병렬 경로로 실행해 한 제공처 지연이 전체 검색을 오래 붙잡지 않게 했습니다. 정상 응답은 기존 RSS 캐시를 재사용합니다.
- 국내 언론사 RSS는 최근 항목 중심의 넓은 피드이므로 검색어가 제목 또는 요약에 하나 이상 나타나는 항목을 관련도순으로 표시합니다. 이전의 다중 검색어 과도 필터링으로 인한 결과 누락을 줄였습니다.
- 뉴스 결과 캐시와 RSS 요청 중복 합치기(in-flight deduplication)는 유지합니다.
- 학술자료는 arXiv만 쓰지 않고 **Crossref REST API + Semantic Scholar Academic Graph API + arXiv API**를 병렬 검색합니다. 검색 결과는 Worker 메모리에서 3분 캐시하고 동일 검색의 동시 요청은 합칩니다.
- 학술 결과는 제공처별 메타데이터를 공통 형식으로 변환하고 DOI/URL/제목 중복을 제거합니다. 공개 PDF URL이 제공되는 경우 결과에 PDF 링크를 표시합니다.
- 학술 제공처 중 일부가 실패해도 나머지 제공처 결과를 보여줍니다. 모든 제공처가 실패한 경우에만 검색 실패로 표시합니다.
- API 키는 필요하지 않으며, Semantic Scholar 등 외부 제공처는 요청 제한(429) 또는 일시 장애가 발생할 수 있습니다.
- 사진 검색, 과제 점검, 학습 기록, 보안 헤더 및 기존 UI는 학술·뉴스 검색 수정 외에는 유지했습니다.

## 제공처와 한계

| 검색 유형 | 제공처 | 한계 |
|---|---|---|
| 뉴스 | Google News RSS + 연합뉴스·뉴시스·SBS·MBN RSS | 언론사 RSS는 최근 게시물 일부만 제공하며 모든 기사를 포함하지 않습니다. 검색어 일치 기준은 넓혀 결과량을 늘렸으므로 관련도가 다양한 결과가 섞일 수 있습니다. |
| 사진 | Flickr 공개 사진 RSS | 태그 기반이며 사진 이용 조건은 원본 페이지에서 확인해야 합니다. |
| 학술자료 | Crossref + Semantic Scholar + arXiv | 통합 메타데이터 검색이며 전체 논문 원문 전문 검색은 아닙니다. 초록·PDF가 없는 레코드도 있습니다. |

## 배포

1. 이 ZIP의 압축을 풀어 기존 GitHub 저장소 루트에 파일을 덮어씁니다.
2. Cloudflare의 기존 Workers + Static Assets 배포 구조를 유지합니다.
3. Node.js 20 이상에서 `npm install`, `npm run deploy`를 실행합니다.
4. 배포 후 `/api/health`에서 `version: 11.2.0-multisource-search`를 확인합니다.

## 테스트

테스트 코드는 배포 ZIP에 넣지 않았습니다. 별도 테스트 ZIP의 `tests/smoke-v11.2.mjs`를 프로젝트 루트 기준으로 실행할 수 있습니다. 이 테스트는 모의 API/RSS 응답으로 Worker 경로와 결과 병합을 확인합니다. 실제 Cloudflare egress에서 모든 외부 제공처가 성공하는지는 배포 후 별도로 확인해야 합니다.

## 보안·운영 메모

- 사용자 입력으로 외부 URL을 지정하지 않습니다. 외부 검색 주소는 코드에 고정되어 있습니다.
- 학술 API는 서버에서만 호출하며 브라우저에 API 키를 노출하지 않습니다.
- RSS 피드는 짧게 캐시하며, 뉴스 RSS는 병렬 조회합니다.
- 요청 제한은 기존 Worker isolate 단위 best-effort 방식입니다. 실제 운영 보호를 위해 Cloudflare 대시보드에서도 `/api/search`에 Rate Limiting 규칙을 추가하는 것을 권장합니다.
