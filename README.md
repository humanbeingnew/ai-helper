# STUDY HUB PRO V11

학생용 자료 탐색 및 과제 점검 웹앱입니다. 배포 대상은 **Cloudflare Workers + Static Assets**입니다. Cloudflare Pages용 프로젝트 구조로 바꾼 것은 아닙니다.

## V11 변경 요약

- 데스크톱/모바일 화면을 재구성하고 모바일 입력 글자 크기, 터치 영역, 탐색 탭을 개선했습니다.
- 화면의 기능 설명을 실제 코드와 일치시켰습니다. `AI 피드백`이 아니라 `규칙 기반 과제 점검`으로 명확히 표시합니다.
- 과제 점검에서 근거·출처, 논리, 구조, 표현을 별도 항목으로 살펴봅니다. 근거가 없다고 사실이 틀렸다고 판정하거나 임의의 정확도 점수를 부여하지 않습니다.
- 과제 본문은 브라우저 안에서만 분석합니다. 서버로 보내지 않으며 학습 기록에도 저장하지 않습니다.
- 학습 기록에는 검색어 또는 과제 제목과 시각만 저장합니다. 브라우저 내보내기/삭제 기능을 추가했습니다.
- `/api/health`로 검색 서버 상태와 버전을 실제 확인해 화면에 표시합니다.
- 뉴스 보완 RSS의 키워드 일치 기준을 개선했습니다. 두 단어 검색은 두 단어가 모두 제목/요약에 들어간 결과를 우선 허용하고, 긴 질의는 핵심어 일치 비율을 적용합니다. 제목 일치도에 더 높은 가중치를 둡니다.
- 검색 API에 IP별 분당 30회, Worker isolate 단위의 best-effort 제한을 추가했습니다.
- 정적 파일 응답에 CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy 등 보안 헤더를 설정했습니다.
- RSS 전용 구조, HTTPS 호스트 allowlist, 수동 리디렉션 검사, 응답 크기 제한, 짧은 캐시, bounded retry를 유지합니다.
- 외부 AI API 키는 추가하지 않았습니다. 실제 생성형 AI 피드백 연결은 V11 범위에 포함하지 않았으며, 이를 연결했다고 표시하지 않습니다.

## 자료 제공처 및 한계

| 검색 유형 | 사용 피드 | 한계 |
|---|---|---|
| 뉴스 | Google News RSS 우선, 실패/빈 피드 시 연합뉴스·뉴시스·SBS·MBN RSS 보완 | 보완 경로는 각 언론사 최근 RSS 항목만 대상으로 하며 전체 뉴스 인덱스가 아님 |
| 사진 | Flickr 공개 사진 RSS | 검색 태그 기반이며 원본 페이지에서 사진 사용 조건 확인 필요 |
| 학술자료 | arXiv 주제별 RSS | Google Scholar 같은 전체 학술 데이터베이스 검색이 아님 |

RSS 검색에는 JSON 검색 API, 일반 웹 검색, 원문 웹페이지 크롤링을 추가하지 않았습니다. RSS가 실패하면 해당 오류를 표시하고 다른 검색 방식으로 몰래 전환하지 않습니다.

## 무료 사용량과 요청 제한

- 외부 AI API 키나 유료 AI API 호출이 없습니다.
- Cloudflare Workers 요금제의 요청/CPU 제한과 외부 RSS 제공처의 자체 제한은 별개입니다.
- V11의 분당 30회 제한은 `CF-Connecting-IP`를 이용한 **Worker isolate별 임시 메모리 제한**입니다. 여러 isolate/colo에서 완전히 공유되지 않으므로 강력한 방어 수단으로 간주하면 안 됩니다.
- 실서비스 보호가 필요하면 Cloudflare 대시보드의 Security/WAF Rate Limiting에서 `/api/search` 경로에 별도 edge rate-limit 규칙을 추가하세요.
- 제한 카운터는 서버 메모리에만 잠시 존재하며 IP를 별도 로그/저장소에 기록하지 않습니다.

## 배포

1. V11 배포 ZIP의 압축을 풉니다.
2. 압축 안의 `package.json`, `wrangler.toml`, `src/`, `public/`, `README.md`, `.gitignore`를 GitHub 저장소 루트에 업로드합니다.
3. Cloudflare에서 해당 Worker 프로젝트를 연결하고, 기존처럼 Workers + Static Assets 설정으로 배포합니다.
4. CLI 배포가 필요하면 Node.js 20 이상에서 다음 명령을 실행합니다.

```bash
npm install
npm run dev
npm run deploy
```

배포 후 아래 주소를 확인합니다.

```text
https://YOUR-WORKER.workers.dev/api/health
https://YOUR-WORKER.workers.dev/api/search?type=news&q=인공지능
https://YOUR-WORKER.workers.dev/api/search?type=photos&q=robot
https://YOUR-WORKER.workers.dev/api/search?type=academic&q=robotics
```

`/api/health`에서 `version: 11.0.0-rss-quality-overhaul`이 나오면 V11 Worker가 응답하고 있는 것입니다. 이 값만으로 세 RSS 제공처의 실시간 연결까지 성공한 것은 아닙니다.

## 보안 메모

- API 키와 `.dev.vars`, `.env` 파일을 포함하지 않습니다.
- 사용자 입력으로 RSS URL을 받지 않습니다. 피드 호스트 allowlist 안의 고정 주소만 요청합니다.
- HTML에는 외부 스크립트를 넣지 않습니다. CSP의 `script-src`는 `'self'`만 허용합니다.
- 검색 결과 링크는 HTTP(S)만 표시하고 새 탭 링크에는 `noopener noreferrer`를 붙입니다.
- 외부 폰트·외부 스크립트·분석 추적 코드를 사용하지 않습니다. 스타일과 스크립트는 같은 출처에서 불러오며, 이미지에 한해 HTTPS와 data URL을 허용합니다.

## 검증 범위

테스트 코드와 테스트 결과는 배포 ZIP에 넣지 않고 별도 `STUDY_HUB_PRO_V11_TESTS.zip`에 분리했습니다. 테스트는 실제 Worker 모듈을 모의 RSS 응답으로 실행합니다. 실제 Cloudflare 계정의 egress IP, WAF 설정, 외부 RSS 제공처 상태는 이 작업 환경에서 대신 검증할 수 없습니다. 배포 후 실제 도메인에서 뉴스·사진·학술자료를 각각 검색해 확인해야 합니다.
