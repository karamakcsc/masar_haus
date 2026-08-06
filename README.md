### Masar Haus

Masar Consulting Haus

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch develop
bench install-app masar_haus
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/masar_haus
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### CI

This app can use GitHub Actions for CI. The following workflows are configured:

- CI: Installs this app and runs unit tests on every push to `develop` branch.
- Linters: Runs [Frappe Semgrep Rules](https://github.com/frappe/semgrep-rules) and [pip-audit](https://pypi.org/project/pip-audit/) on every pull request.


### Changelog

**2026-07-27 — Opportunity Dashboard & Analytics Report**

Opportunity Dashboard (`Dashboard` doctype, `masar_haus.bundle.js`/`.scss`):
- Added a 4th number-card row — Total/CF/GRC "All Opportunities" (Won+Live+Lost combined) — above the existing Live/Won/Lost rows.
- 3-across donut layout ("Opportunity Value by Status") with a custom vertical legend replacing frappe-charts' built-in one, abbreviated (M) values, and a shared bar-value-label plugin for the Monthly/Pipeline charts.
- Responsive fixes: donut/bar chart sizing and horizontal scroll on mobile, a CSS Grid `min-width:0` fix so an oversized chart measurement no longer inflates its whole card, and tagging chart widgets by title as soon as they render (rather than after their async data resolves) so the 3-column grid settles before any chart is measured.

Opportunity Analytics Report (custom Page — `opportunity_analytics_report.py`/`.js`):
- Filter bar: Department (`custom_item_group`), Territory, Main Stage (`sales_stage`), Sales Stage (`custom_sales_stage_1`), Main Industry (`industry`), Industry (`custom_sub_industry`).
- Fixed a Chart.js lifecycle bug where the doughnut/pipeline charts never called `.destroy()` on the previous instance before re-rendering on a filter change, leaving stale instances attached to removed canvases and causing intermittent blank charts.
- Mobile layout: summary/table/doughnut rows became horizontally-swipeable carousels instead of stacking into one long column, and the Pipeline/Monthly bar charts get real per-category width with horizontal scroll instead of squeezed/truncated labels.
- Export to Excel: generates a real `.xlsx` (via ExcelJS) with a Summary sheet (styled cards), Top-5 CF/GRC tables, and Pipeline/Monthly/Charts sheets with the charts embedded as images (ExcelJS has no live-chart API).
- Export to PDF: generates the PDF directly (via jsPDF + autotable) instead of the browser's print dialog, laying out every card, table, and chart image explicitly with controlled page breaks.
- Both exports show the currently active filters (or "None (showing all data)") so an exported file makes sense read out of context.

**2026-08-06 — Mobile scroll fixes for both dashboards**

Opportunity Dashboard (`masar_haus.bundle.js`/`.scss`):
- Split the single `is_mobile_width()` check into separate donut-height (560px) and bar-chart-scroll (900px) thresholds, aligning the bar-chart fix with the SCSS grid's actual mobile breakpoint — previously both shared one 560px threshold, so viewports between 561-900px (phones in landscape, phablets, small tablets) got the narrower grid without the compensating per-category-width fix, and frappe-charts truncated the Monthly/Pipeline chart labels again.
- Added a debounced resize/orientationchange listener so rotating the device re-applies the bar-chart scroll fix instead of requiring a full reload.
- Added `touch-action`/`overscroll-behavior-x` to `.masar-chart-scroll` as defense-in-depth against a vertical swipe being captured as horizontal panning.

Opportunity Analytics Report:
- Replaced the mobile carousel (flex + `overflow-x: auto` + `scroll-snap`) for the Summary/Top-5/Doughnut sections with a single-column grid collapse — the carousel could capture a vertical swipe as horizontal panning on some mobile browsers, leaving the page unable to scroll past the first card.
- Diagnosed a follow-up mobile scroll-jank complaint with a live on-device diagnostic (confirmed the scroll container was correctly configured with plenty of overflow, not blocked) and mitigated the actual cause — 5 live Chart.js canvases plus ~10 shadowed cards now stacked into one long page: capped Chart.js's `devicePixelRatio`, throttled its resize-triggered redraws (`resizeDelay`), and added CSS containment (`contain: layout style`) to `.opp-panel` so each card's layout doesn't force a whole-page recalculation on every scroll frame.
- Note for future edits to this page: its controller script isn't part of the bundled/hashed asset pipeline, so it's easy to assume `bench build` is irrelevant to it — but it's still required, because Frappe's client-side page cache (`localStorage["_page:<name>"]`) is only busted when `bench build` changes `assets.json`'s timestamp. Skipping it after an edit leaves browsers serving a stale cached copy of this page indefinitely, with no server-side symptom to indicate why.

### License

mit
