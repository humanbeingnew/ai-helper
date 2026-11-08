# STUDY HUB PRO V2

학생을 위한 무료 학습 자료 탐색 및 자동 피드백 웹앱입니다. Gemini 등 외부 생성형 AI API를 사용하지 않으며, API 키나 회원가입이 필요하지 않습니다.

## 핵심 기능
- 자료 탐색: OpenAlex 학술 메타데이터와 한국어 Wikipedia 개요 검색
- 내용·정확성 점검: 단정 표현, 숫자·통계, 출처 표시, 근거 표현 확인
- 논리·구성 점검: 이유와 결과 연결, 문단 구성, 전개 표현 확인
- 완성도·표현 점검: 글의 분량, 문장 길이, 결론, 과제 유형별 구성 확인
- 개선 제안 및 브라우저 학습 기록(최근 40건)
- PC / 태블릿 / 스마트폰 반응형 UI

## 피드백의 한계
피드백은 브라우저에서 실행되는 규칙 기반 자동 점검이며 생성형 AI가 아닙니다. 인터넷 원문과 대조해 사실 여부를 확정하지 않고 문맥을 완벽히 이해하지도 않습니다. 숫자·단정 표현·출처가 필요한 문장을 표시해 학생이 직접 원자료를 확인하도록 돕습니다. 점수는 성적이나 객관적 평가가 아닌 수정 참고 지표입니다.

## GitHub 업로드
압축을 푼 뒤 `public`, `functions`, `README.md`를 GitHub 저장소 최상단에 업로드합니다. 테스트 산출물은 별도 ZIP에 있으므로 배포 저장소에 올리지 마세요.

## Cloudflare Pages 배포
- Framework preset: `None`
- Build command: 비워 둠
- Build output directory: `public`
- Root directory: `/`

`functions/api/search.js`가 Pages Function으로 `/api/search`를 제공합니다. 피드백은 브라우저에서 실행되므로 서버 환경 변수 설정이 필요 없습니다.

## 개인정보
작성한 과제 텍스트는 피드백 분석을 위해 외부 서버로 전송하지 않습니다. 검색어는 공개 자료 검색을 위해 Cloudflare Pages Function과 자료 제공처로 전달됩니다. 학습 기록은 현재 브라우저의 localStorage에 저장됩니다.
