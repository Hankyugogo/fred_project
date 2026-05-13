# US Daily Economy Briefing

미국 경제 수치와 주요 뉴스 흐름을 매일 자동 수집해 한국어 데일리 브리핑으로 만드는 정적 리포트 프로젝트입니다.

현재 파이프라인은 FRED 지표 데이터, 공개 RSS/뉴스 검색 헤드라인, 규칙 기반 시장 해석, 날짜별 Markdown 본문, 금융 리포트형 HTML 출력까지 연결되어 있습니다.

## 핵심 결과물

- `report.html`: 최신 금융 리포트형 HTML
- `reports/YYYY-MM-DD.html`: 날짜별 독립 HTML 리포트
- `posts/YYYY-MM-DD.md`: 날짜별 Markdown 브리핑 본문
- `data/briefings.json`: 웹 대시보드가 읽는 브리핑 인덱스
- `data/market-snapshot.json`: FRED 기반 지표 스냅샷
- `data/news-digest.json`: 공개 뉴스/RSS 수집 결과

## 실행

```bash
cd /Users/parkhankyu/박한규/personal-work/economy/fred-market-briefing
FRED_API_KEY="your_fred_api_key" npm run publish:full
npm run serve
```

브라우저 확인:

- `http://127.0.0.1:8080/`
- `http://127.0.0.1:8080/report.html`
- `http://127.0.0.1:8080/reports/YYYY-MM-DD.html`

## 명령

- `npm run fetch:news`: 공개 RSS/뉴스 검색 헤드라인을 수집해 `data/news-digest.json` 생성
- `npm run build:data`: FRED API에서 주요 지표를 수집해 `data/market-snapshot.json` 생성
- `npm run publish:data`: FRED 스냅샷을 날짜별 Markdown/JSON 브리핑으로 적재
- `npm run report:html`: 최신 브리핑을 금융 리포트형 HTML로 렌더링
- `npm run publish:full`: 뉴스 수집, FRED 수집, 브리핑 발행, HTML 리포트 생성을 한 번에 실행
- `npm run publish:full-demo`: FRED 데모 데이터와 실제 뉴스 수집을 결합해 전체 파이프라인 점검
- `npm run seed:demo-archive`: 점검용 날짜별 데모 아카이브 생성
- `npm run serve`: 로컬 정적 서버 실행

## 데이터 소스

FRED 시리즈:

- `SP500`, `NASDAQCOM`, `DJIA`
- `DGS2`, `DGS10`, `DFF`, `10Y-2Y` 파생 스프레드
- `VIXCLS`
- `DEXKOUS`, `DTWEXBGS`
- `DCOILWTICO`

뉴스 소스:

- Federal Reserve press releases
- Federal Reserve speeches
- MarketWatch RSS
- Google News RSS search for US macro and markets

뉴스 수집은 기사 본문을 복제하지 않고 제목, 출처, 링크, 발행 시점만 저장합니다.

## 편집 기준

독자에게 노출되는 용어 기준은 `config/editorial-style.json`에 정리했습니다.
예를 들어 `Confidence`, `Publication`, `위험선호 우위`, `리스크온` 같은 내부식 표현은 보고서 화면에 그대로 노출하지 않습니다.

## 자동화

전체 자동화 명령은 `npm run publish:full`입니다.

GitHub Actions용 예시는 `.github/workflows/daily-report.yml`에 있습니다. 원격 저장소에서 쓰려면 repository secret에 `FRED_API_KEY`를 등록하면 매일 06:10 KST에 새 리포트를 생성하고 커밋합니다.

로컬 자동화는 `automation/README.md`를 참고하면 됩니다.

## 현재 남은 개선 포인트

- 주요 뉴스 원문 요약을 붙이려면 별도 뉴스 API 또는 허용된 원문 수집 정책이 필요합니다.
- 금융사 수준 문장 품질을 더 올리려면 규칙 기반 해석 위에 LLM 편집 단계를 얹는 것이 좋습니다.
- 배포까지 완성하려면 GitHub Pages 또는 Cloudflare Pages 연결이 필요합니다.
