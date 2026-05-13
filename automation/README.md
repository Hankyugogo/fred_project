# Daily Automation

이 프로젝트의 전체 자동 생성 명령은 아래 하나입니다.

```bash
cd /Users/parkhankyu/박한규/personal-work/economy/fred-market-briefing
FRED_API_KEY="your_fred_api_key" npm run publish:full
```

생성되는 결과물:

- `data/news-digest.json`
- `data/market-snapshot.json`
- `data/briefings.json`
- `posts/YYYY-MM-DD.md`
- `reports/YYYY-MM-DD.html`
- `report.html`

## GitHub Actions

`.github/workflows/daily-report.yml`은 매일 06:10 KST에 `npm run publish:full`을 실행합니다.
원격 저장소에서 쓰려면 repository secret에 `FRED_API_KEY`를 추가해야 합니다.

## Local Scheduler

macOS 로컬 자동화는 launchd나 Codex automation에서 같은 명령을 매일 실행하면 됩니다.
API 키는 파일에 하드코딩하지 말고 사용자 환경변수나 안전한 secret 저장소에서 주입하는 편이 좋습니다.
