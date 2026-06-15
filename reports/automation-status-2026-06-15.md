# 자동 생성 점검 기록 · 2026-06-15

작성 기준: 2026-06-15 09:58 KST

## 결론

- 2026-06-15 오늘자 `Daily Economy Report` 스케줄 실행은 09:58 KST 기준 GitHub Actions에 생성되지 않았다.
- 오늘자 리포트는 수동 생성 후 배포했다.
- 공개본: `https://hankyugogo.github.io/fred_project/report.html`
- 리포트 일자: 2026-06-15
- 미국 주식 기준일: 2026-06-12
- 한국 시장 기준일: 2026-06-15
- 최종 배포: `Deploy Existing Report` #8, 2026-06-15 09:56 KST, 성공

## 왜 늦거나 안 됐나

1. GitHub Actions 스케줄 자체가 정시에 보장되지 않는다.
   - GitHub 문서상 scheduled workflow는 Actions 부하가 큰 시간대에 지연되거나 누락될 수 있다.
   - 근거: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule
   - 기존 설정은 08:15 KST 1회였지만, 실제 성공 실행은 10:30~10:48 KST에 몰렸다.
   - 2026-06-15에는 09:58 KST까지 스케줄 run이 생성되지 않았다.

2. 외부 데이터 소스 제한이 품질 검사를 막았다.
   - Yahoo Finance 429 응답이 계속 발생했다.
   - Gemini 보강 호출도 429 quota에 걸렸다.
   - 이 때문에 WTI/Brent 같은 보조지표가 오래된 값으로 남아 `check:quality`에서 실패했다.

3. 생성 후 보정 문구가 시장 방향과 반대로 쓰이는 문제가 있었다.
   - 2026-06-15 미국 3대 지수는 상승했는데, fallback 해설 일부가 약세장 문구로 고정돼 있었다.
   - `scripts/fill-briefing-fallback.mjs`를 지수 방향에 따라 문구가 바뀌도록 수정했다.

## 적용한 조치

- 스케줄 변경:
  - 1차: 06:07 KST
  - 2차 백업: 09:07 KST
  - 같은 날짜 리포트가 이미 있으면 백업 스케줄은 중복 생성을 건너뛴다.
- 원자재 보강 소스 추가:
  - WTI, Brent, Gold, Copper를 Naver market index에서 보강한다.
  - Yahoo 429가 나도 원유/금속 최신성이 바로 깨지지 않게 했다.
- 오늘자 재생성:
  - `posts/2026-06-15.md`
  - `reports/2026-06-15.html`
  - `report.html`
  - `archive/2026-06-15/latest`
  - `archive/2026-06-15/runs/20260615T005351646Z`
- 검사:
  - `npm run check:quality`: 통과
  - `npm run check:copy`: 통과
  - `node --check scripts/fetch-market-supplements.mjs`: 통과
  - `node --check scripts/fill-briefing-fallback.mjs`: 통과

## Daily Economy Report 실행 이력

시각은 모두 KST 기준이다. 성공한 경우 "완료" 시각이 실제 생성·배포가 끝난 시간에 가깝다.

| 날짜 | 실행 | 트리거 | 결과 | 시작 | 완료 | 비고 |
|---|---:|---|---|---:|---:|---|
| 2026-06-15 | - | schedule | 미생성 | - | - | 09:58 KST 기준 run 없음. 수동 생성·배포 완료 |
| 2026-06-14 | #34 | schedule | success | 10:37 | 10:40 | [run](https://github.com/Hankyugogo/fred_project/actions/runs/27484903759) |
| 2026-06-13 | #33 | schedule | success | 10:34 | 10:37 | [run](https://github.com/Hankyugogo/fred_project/actions/runs/27452635209) |
| 2026-06-12 | #32 | schedule | success | 10:39 | 10:42 | [run](https://github.com/Hankyugogo/fred_project/actions/runs/27388897246) |
| 2026-06-11 | #31 | schedule | success | 10:41 | 10:45 | [run](https://github.com/Hankyugogo/fred_project/actions/runs/27318108341) |
| 2026-06-10 | #30 | schedule | success | 10:30 | 10:37 | [run](https://github.com/Hankyugogo/fred_project/actions/runs/27247045837) |
| 2026-06-09 | #29 | schedule | failure | 09:15 | 09:19 | [run](https://github.com/Hankyugogo/fred_project/actions/runs/27175405271) |
| 2026-06-08 | #28 | schedule | success | 10:34 | 10:37 | [run](https://github.com/Hankyugogo/fred_project/actions/runs/27111167446) |
| 2026-06-07 | #27 | schedule | failure | 09:17 | 09:21 | [run](https://github.com/Hankyugogo/fred_project/actions/runs/27077820120) |

## 오늘 수동 배포 이력

| 실행 | 결과 | 시작 | 완료 | 커밋 | 비고 |
|---:|---|---:|---:|---|---|
| Deploy #8 | success | 09:56 | 09:56 | `120bc0c` | 6월 15일 해설 문구 방향 수정 후 배포 |
| Deploy #7 | success | 09:50 | 09:51 | `225c560` | 6월 15일 리포트 생성 및 스케줄 보강 |

## 덮어쓰기 정책

- `report.html`은 항상 최신 리포트로 덮어쓴다.
- `reports/YYYY-MM-DD.html`은 같은 날짜를 다시 만들면 그 날짜 HTML만 덮어쓴다.
- `posts/YYYY-MM-DD.md`도 같은 날짜를 다시 만들면 덮어쓴다.
- `archive/YYYY-MM-DD/latest`는 같은 날짜의 최신 실행본으로 덮어쓴다.
- `archive/YYYY-MM-DD/runs/<run-id>`는 실행별 보관본이다. 오늘은 잘못된 중간 실행본 대신 최종 실행본 `20260615T005351646Z`만 남겼다.
- 이전 버전은 Git 커밋 기록에서 다시 볼 수 있다.
