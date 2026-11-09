# STUDY HUB PRO · RSS ONLY V7

학생용 학습 플랫폼입니다. 자료 검색 엔진을 RSS 피드 전용 구조로 다시 구성했습니다. 학습 피드백과 학습 기록 기능은 기존처럼 브라우저 안에서 작동합니다.

## 1. 검색 시스템 원칙

검색 데이터 수집은 외부 RSS 피드만 사용합니다. 브라우저에 결과를 전달하는 Worker 내부 응답은 기존 구조와 호환되도록 JSON을 사용하지만, 외부 자료를 검색·수집할 때는 RSS 피드만 요청합니다.

- 외부 검색용 JSON API를 호출하지 않습니다.
- 일반 웹 검색을 호출하지 않습니다.
- 검색 결과 페이지나 기사 페이지를 HTML 크롤링하지 않습니다.
- RSS 제공처에 연결되지 않으면 다른 방식으로 자동 대체하지 않습니다.
- 검색 영역은 뉴스, 사진, 학술자료로 분리되어 있습니다.

## 2. 검색 제공처

| 화면 | RSS 제공처 | 검색 방법 |
|---|---|---|
| 뉴스 | Google News RSS | 입력한 검색어를 Google News 검색 RSS에 전달 |
| 사진 | Flickr 공개 사진 RSS | 입력한 검색어를 사진 태그 RSS에 전달하고 이미지가 있는 항목만 표시 |
| 학술자료 | arXiv RSS 2.0 | 검색어 주제에 맞는 arXiv 카테고리 RSS를 선택한 뒤 피드 항목 안에서 검색어를 필터링 |

### Google RSS 사용 범위와 한계

- Google News는 검색어별 RSS 검색 피드를 사용합니다.
- Google Images는 검색 결과 RSS 피드를 제공하지 않으므로 사진 탭은 Flickr 공개 사진 RSS를 사용합니다.
- Google Scholar는 검색 결과 RSS를 제공하지 않고 이메일 알림 중심이므로 학술 탭은 공식 arXiv RSS 카테고리 피드를 사용합니다.
- arXiv 학술 검색은 선택된 주제 카테고리의 RSS 항목 안에서 키워드를 찾습니다. 따라서 arXiv에 등록되지 않은 논문이나 다른 학술 데이터베이스의 전체 논문을 포괄하지 않습니다.

## 3. RSS 처리 방식

1. 검색어와 자료 유형을 Worker에 전달합니다.
2. 자료 유형에 맞는 RSS 주소 하나를 생성합니다.
3. Worker가 XML RSS 피드를 직접 가져옵니다.
4. RSS의 제목, 설명, 원문 링크, 작성자, 발행일, 이미지 메타데이터를 읽습니다.
5. 같은 제목을 정리하고 결과를 화면에 표시합니다.

RSS 파싱은 Worker 안의 작은 XML 태그 파서로 처리합니다. 별도 검색 SDK, JSON API, HTML 파서 또는 스크래핑 라이브러리는 사용하지 않습니다.

## 4. API 확인

배포 주소를 `YOUR-WORKER`로 바꿔 사용합니다.

```text
GET https://YOUR-WORKER.workers.dev/api/health
GET https://YOUR-WORKER.workers.dev/api/search?type=news&q=인공지능
GET https://YOUR-WORKER.workers.dev/api/search?type=photos&q=로봇
GET https://YOUR-WORKER.workers.dev/api/search?type=academic&q=인공지능
```

`/api/health`는 `searchMode: rss-only`와 활성 RSS 제공처를 반환합니다.

## 5. 프로젝트 구조

```text
public/
  index.html
  styles.css
  app.js
  favicon.svg
src/
  index.js
package.json
wrangler.toml
README.md
```

## 6. Cloudflare 배포

```bash
npm install
npm run deploy
```

Cloudflare Pages가 아닌 Workers + Static Assets 구조입니다. GitHub에 업로드할 때 이 ZIP의 프로젝트 루트에 `wrangler.toml`이 있어야 합니다.

## 7. 참고 및 운영 한계

- RSS 제공처의 접근 제한, 일시 장애, 피드 형식 변경에 따라 검색이 실패할 수 있습니다.
- 실패 시 오류를 그대로 표시하며 비-RSS 검색으로 전환하지 않습니다.
- Flickr 사진의 재사용 권한은 사진마다 다를 수 있습니다. 사용 전에 원문 페이지의 라이선스와 이용 조건을 확인해야 합니다.
- arXiv 피드는 카테고리 단위로 갱신되므로 실시간 전체 학술 검색이 아닙니다.
- Google News RSS는 Google News가 색인한 뉴스 범위에 한정됩니다.

## 8. 개인정보

학습 피드백 입력 내용은 서버 검색 API로 전송되지 않습니다. 검색어는 RSS 수집을 위해 Cloudflare Worker와 해당 RSS 제공처로 전달됩니다. 학습 기록은 현재 브라우저의 `localStorage`에 저장됩니다.
