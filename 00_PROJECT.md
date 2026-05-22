---
type: project
status: active
area: personal-economy
project_id: fred-market-briefing
created: 2026-05-14
updated: 2026-05-22
original_path: /Users/parkhankyu/박한규/personal-work/economy/fred-market-briefing
current_path: /Users/parkhankyu/Knowledge-OS/01_Areas/personal-economy/projects/fred-market-briefing
remote: https://github.com/Hankyugogo/fred_project
tags:
  - project
  - economy
  - fred
  - market-briefing
  - static-report
---

# FRED Market Briefing

## Identity

Area: personal-economy  
Category: market data pipeline / daily briefing / static report  
Status: active  
Original path: `/Users/parkhankyu/박한규/personal-work/economy/fred-market-briefing`  
Current path: `/Users/parkhankyu/Knowledge-OS/01_Areas/personal-economy/projects/fred-market-briefing`

## Goal

Automatically collect U.S. economic indicators and market/news context, then publish Korean daily economy briefings and static HTML reports.

## Context

This project belongs to the `personal-economy` Area. It was moved into Knowledge-OS on 2026-05-22 after creating backup commit `220817f` (`Backup before Knowledge-OS migration`).

## Current Source Of Truth

- Project guide: `README.md`
- Package scripts: `package.json`
- Main integrated report page: `index.html`
- Options page: `settings.html`
- Latest report output: `report.html`
- Daily Markdown posts: `posts/`
- Static HTML reports: `reports/`
- Configuration: `config/`
- Scripts: `scripts/`
- Data output: `data/`
- Automation notes: `automation/README.md`

## Operational Dependencies

- `.env` may contain `FRED_API_KEY` or other secrets. Do not read, print, or move it unless explicitly requested.
- The project has a remote Git repository: `https://github.com/Hankyugogo/fred_project`.
- Git status was dirty during the 2026-05-14 folder review, then preserved in backup commit `220817f` before physical migration on 2026-05-22.
- `README.md` and `automation/README.md` used to contain hard-coded `cd /Users/parkhankyu/박한규/personal-work/economy/fred-market-briefing` examples. They were converted to repository-root instructions on 2026-05-21.
- Local scheduler entries outside this repository still need review because they may assume the old path.
- `package.json`, `.github/workflows/daily-report.yml`, and the checked scripts are mostly repo-root relative, so the main code path appears portable if launched from the repository root.
- The former untracked `경제 리포트/` folder was identical to `/Users/parkhankyu/Downloads/경제 리포트` by `diff -qr` and was removed from this repository with owner approval on 2026-05-21.

## Current Commands

- `npm run publish:full`: full production-style pipeline
- `npm run publish:full-demo`: demo pipeline
- `npm run build:stocks`: build watchlist data
- `npm run report:html`: render latest report
- `npm run serve`: local static server on port 8080

## Do Not

- Do not move this folder again before checking Git status, scheduler paths, and runtime dependencies.
- Do not edit `.env` without explicit approval.
- Do not treat generated `data/`, `report.html`, or `reports/` as source unless the task explicitly targets output files.
- Do not overwrite editorial configuration without checking `config/editorial-style.json`.
- Do not reintroduce the nested `경제 리포트/` duplicate into this repository.

## Next Actions

- Update any local scheduler entry that assumes the old directory.
- Use `settings.html` for watchlist add/edit/delete instead of direct vibe-coding changes.
- Standardize the public concept as a Korean daily macro briefing and static report system.
- Pass `npm run check:copy` by removing remaining editorial avoid terms from generated outputs and generation scripts.
- Decide whether the remaining `/Users/parkhankyu/Downloads/경제 리포트` reference copy should be archived or deleted.
- Preserve `.env` without printing its contents if the whole repository is moved.
