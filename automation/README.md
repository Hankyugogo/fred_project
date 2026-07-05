# Daily Automation

이 프로젝트의 전체 자동 생성 명령은 아래 하나입니다.

```bash
# 저장소 루트에서 실행
npm run publish:full
```

생성되는 결과물:

- `data/news-digest.json`
- `data/market-snapshot.json`
- `data/briefings.json`
- `data/macro-history.json`
- `data/watchlist-prices.json`
- `data/stock-watchlist.json`
- `posts/YYYY-MM-DD.md`
- `reports/YYYY-MM-DD.html`
- `report.html`
- `archive/YYYY-MM-DD/latest/*`
- `archive/YYYY-MM-DD/runs/RUN_ID/*`
- `archive/YYYY-MM-DD/validations/VALIDATION_RUN_ID.json`
- `data/outcome-validations.json`

## GitHub Actions

`.github/workflows/daily-report.yml`은 매일 06:07 KST에 1차 실행, 09:07 KST에 예비 실행으로 `npm run publish:full-rich`를 실행합니다. 예비 실행은 같은 날짜 리포트가 이미 커밋되어 있으면 중복 생성하지 않습니다.
원격 저장소에서 쓰려면 repository secret에 `FRED_API_KEY`, `GEMINI_API_KEY`를 추가해야 합니다.

워크플로는 LLM 리라이트 검증을 엄격 모드(`STRICT_REWRITE_VALIDATION=1`)로 실행합니다. 리라이트가 quota, 숫자 검증, 민감 뉴스 검증, 오래된 지표 서술 검증에서 실패하면 로컬 fallback 본문을 채우고 HTML을 렌더링합니다.

생성 후에는 `npm run check:quality`와 `npm run check:copy`를 통과해야만 생성물을 커밋하고 GitHub Pages artifact를 배포합니다. 리포트 보관 뒤에는 `npm run verify:outcomes:all`이 실행되어 과거 리포트의 1거래 세션·5거래 세션 후속 흐름을 `archive/YYYY-MM-DD/validations/`와 `data/outcome-validations.json`에 기록합니다. 이메일/텔레그램 secrets가 있으면 알림도 보냅니다.

선택 secrets:

- `EMAIL_USERNAME`
- `EMAIL_APP_PASSWORD`
- `EMAIL_TO`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Local Scheduler

macOS 로컬 자동화는 launchd나 Codex automation에서 같은 명령을 매일 실행하면 됩니다.
API 키는 파일에 하드코딩하지 말고 사용자 환경변수나 안전한 secret 저장소에서 주입하는 편이 좋습니다.
