# US Daily Economy Briefing

미국 경제 수치와 주요 뉴스 흐름을 매일 자동 수집해 한국어 데일리 브리핑으로 만드는 정적 리포트 프로젝트입니다.

현재 파이프라인은 FRED 지표, Yahoo 보조 시세, 공개 RSS/뉴스 검색 헤드라인, Gemini 기반 요약·맥락 보강·리라이트, 날짜별 Markdown 본문, 금융 리포트형 HTML 출력까지 연결합니다.

## 핵심 결과물

- `report.html`: 최신 금융 리포트형 HTML
- `reports/YYYY-MM-DD.html`: 날짜별 독립 HTML 리포트
- `posts/YYYY-MM-DD.md`: 날짜별 Markdown 브리핑 본문
- `data/briefings.json`: 웹 대시보드가 읽는 브리핑 인덱스
- `data/market-snapshot.json`: FRED 기반 지표 스냅샷
- `data/news-digest.json`: 공개 뉴스/RSS 수집 결과
- `data/stock-watchlist.json`: 관심종목 매크로·기술 분석 데이터
- `settings.html`: 관심종목과 분석 메모를 관리하는 옵션 페이지

## 로컬 실행

```bash
# 저장소 루트에서 실행
npm run publish:full
npm run serve
# 관심종목을 파일에 직접 저장하고 재생성까지 하려면 별도 터미널에서 실행
npm run admin
```

브라우저 확인:

- `http://127.0.0.1:8080/`
- `http://127.0.0.1:8080/report.html`
- `http://127.0.0.1:8080/settings.html`
- `http://127.0.0.1:8081/settings.html` (`npm run admin` 실행 시 프로젝트 저장/분석 재생성 가능)
- `http://127.0.0.1:8080/reports/YYYY-MM-DD.html`

## 주요 명령

- `npm run fetch:news`: 공개 RSS/뉴스 검색 헤드라인을 수집해 `data/news-digest.json` 생성
- `npm run summarize:news`: 뉴스 헤드라인을 한국어 경제지 문체로 요약
- `npm run build:data`: FRED API에서 주요 지표를 수집해 `data/market-snapshot.json` 생성
- `npm run enrich:stale`: FRED 지연 시계열을 보충 시세로 보강
- `npm run enrich:context`: 섹터 ETF, 크로스에셋, 이벤트 캘린더 맥락 보강
- `npm run build:stocks:full`: 관심종목 가격 이력 수집 후 분석 데이터 생성
- `npm run fetch:macro`: 다기간 비교용 매크로 시계열 생성
- `npm run rewrite:llm`: 최신 브리핑을 LLM으로 재작성
- `npm run report:html`: 최신 브리핑을 금융 리포트형 HTML로 렌더링
- `npm run publish:full`: 전체 자동 생성 파이프라인 실행
- `npm run check:copy`: 공개 산출물의 금칙/치환 대상 표현 점검
- `npm run fix:copy`: 공개 산출물에 문구 치환 규칙 일괄 적용
- `npm run admin`: 로컬 관리자 서버 실행. 옵션 페이지에서 `config/watchlist-stocks.json` 저장과 관심종목 분석 재생성 수행

## 관심종목 옵션

`settings.html`에서 `config/watchlist-stocks.json`을 불러와 관심종목을 추가·복제·삭제하고 분석 메모를 수정할 수 있습니다. 일반 정적 서버에서는 브라우저 저장, JSON 복사, 파일 저장/내보내기를 사용할 수 있습니다. `npm run admin`으로 `http://127.0.0.1:8081/settings.html`을 열면 옵션 페이지에서 프로젝트 설정을 바로 저장하고 `npm run build:stocks:full` 재생성까지 실행할 수 있습니다.

## 데이터 소스

FRED 시리즈:

- `SP500`, `NASDAQCOM`, `DJIA`
- `DGS2`, `DGS10`, `DFF`, `10Y-2Y` 파생 스프레드
- `VIXCLS`
- `DEXKOUS`, `DTWEXBGS`, `DEXJPUS`
- `DCOILWTICO`, `DCOILBRENTEU`

보조 시세:

- Yahoo Finance chart API: 한국 지수, 관심종목, 매크로 다기간 비교
- Gemini Google Search grounding: 섹터 ETF, 크로스에셋, 주요 이벤트 일정

뉴스 소스:

- Federal Reserve press releases
- Federal Reserve speeches
- MarketWatch RSS
- Google News RSS search for US macro and markets

뉴스 수집은 기사 본문을 복제하지 않고 제목, 출처, 링크, 발행 시점, 요약 메타데이터 중심으로 저장합니다.

## GitHub Actions 자동화

워크플로 파일은 `.github/workflows/daily-report.yml`입니다.

동작 순서:

1. 매일 08:15 KST에 `npm run publish:full` 실행
2. `data`, `posts`, `reports`, `report.html` 생성물 커밋·푸시
3. `index.html`, `settings.html`, `app.js`, `settings.js`, `styles.css`, `report.html`, `config`, `data`, `posts`, `reports`를 GitHub Pages artifact로 업로드
4. GitHub Pages로 배포
5. Secrets가 있으면 이메일과 텔레그램 알림 전송

필수 repository secrets:

- `FRED_API_KEY`
- `GEMINI_API_KEY`

알림용 선택 secrets:

- `EMAIL_USERNAME`
- `EMAIL_APP_PASSWORD`
- `EMAIL_TO`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

GitHub Pages는 저장소 Settings -> Pages에서 Source를 `GitHub Actions`로 설정해야 합니다.

배포 URL:

- `https://hankyugogo.github.io/fred_project/report.html`

## 알림

`scripts/notify-build-payload.mjs`가 최신 `data/briefings.json`에서 제목, 요약, 리포트 URL을 생성합니다.

- 이메일: Gmail SMTP로 요약 본문과 `report.html` 첨부 발송
- 텔레그램: 메시지와 `report.html` 파일 전송

Secrets가 비어 있으면 해당 알림 단계는 자동으로 건너뜁니다.

## 편집 기준

독자에게 노출되는 용어 기준은 `config/editorial-style.json`에 정리했습니다.
문체·용어 정리는 별도 작업으로 관리하며, 자동화 배선과 분리합니다.
