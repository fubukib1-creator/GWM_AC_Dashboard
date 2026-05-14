# Architecture

## System map

```
                ┌─────────────────────────────────────┐
                │     ev.rpdservice.com (portal)      │
                │   run by EVW Service · production   │
                └────────┬───────────────────────────┬┘
                         │                            │
                  same-origin                      HTTP POST /auth/login
                  fetch (JWT)                       + GETs
                         │                            │
            ┌────────────┴──────────┐    ┌────────────┴──────────────┐
            │   v2 — bookmarklet    │    │  scripts/pull-daily.ps1   │
            │   live overlay        │    │  (daily / on-demand)      │
            │                       │    │                           │
            │   injected as a       │    │  writes one snapshot per  │
            │   <div> overlay on    │    │  day; updates index.csv   │
            │   the portal page     │    └────────────┬──────────────┘
            └───────────────────────┘                 │
                                                       ▼
                                             ┌────────────────────┐
                                             │  data/             │
                                             │   index.csv        │
                                             │   snapshots/       │
                                             │     YYYY-MM-DD.json│
                                             └────────┬───────────┘
                                                       │
                                                  fetch via
                                              http://localhost:8765
                                                       │
                                             ┌────────▼───────────┐
                                             │  v3 — local dash   │
                                             │  served by         │
                                             │  serve.ps1         │
                                             │  via 'Open         │
                                             │  Dashboard.cmd'    │
                                             └────────────────────┘
```

## Three views, three data paths

### v2 — Live overlay (bookmarklet)

**Path:** Portal browser → bookmarklet → injected overlay → `fetch('/api/v1/...')` → renders.

**How it works:**
1. User drags `bookmarklet.html`'s "INNOPOWER Ops" link to bookmark bar (one-time setup).
2. User logs into `ev.rpdservice.com` as normal.
3. Clicking the bookmark runs a `javascript:` URL that contains the entire dashboard (sla-engine + payload + launcher) URL-encoded inline.
4. The launcher checks `location.hostname === 'ev.rpdservice.com'`, then calls `InnopowerOpsConsole.mount({mode:'live'})`.
5. `mount()` appends `<div id="innopower-overlay">` to `document.body` — full-viewport, `z-index: 2147483647`.
6. The overlay's Refresh button calls 5 portal endpoints in parallel (`/auth/me`, `/statuses`, 4× `/jobs?status=...`) using the JWT from `localStorage.auth._token.admin`.
7. Data is tagged with `parent_status` from the bucket source (not from the embedded `Status.parent_status`, which is unreliable — see [decisions.md ADR-003](decisions.md#adr-003-bucket-source-over-embedded-status-fields)).
8. Hydration step backfills missing `Status.id` from the taxonomy lookup ([ADR-004](decisions.md#adr-004-status-hydration)).
9. SLA flag engine runs (`computeFlags(jobs, now)`) producing 7 rule types with severity tagging.
10. UI renders: KPI strip · pipeline funnel · SLA tile row · 21-cell status heat-strip · 6 tabs (Flags / Issues / Geo / Team / Trend / Methodology).

**Files involved:**
- `Dashboard/v2/bookmarklet.html` — installer page with drag link
- `Dashboard/v2/bookmarklet.url.txt` — raw javascript: href, kept in sync with bookmarklet.html
- `Dashboard/v2/payload.js` — the IIFE (DOM, render, fetch, ~74 KB)
- `Dashboard/v2/sla-engine.js` — pure SLA computation (~10 KB)
- `Dashboard/v2/innopower-ops-console.html` — standalone preview (loads payload.js with demo data; useful for design iteration)
- `Dashboard/v2/build-bookmarklet.ps1` — the build script (rarely runs as a file due to PowerShell execution policy; usually runs inline — see [ADR-002](decisions.md#adr-002-inline-powershell-instead-of-running-ps1-files-during-development))

**Rebuild trigger:** any change to `payload.js` or `sla-engine.js` requires re-running the build to refresh `bookmarklet.html` + `bookmarklet.url.txt`. Then the user must drag the link again to overwrite the existing bookmark.

### v3 — Local snapshot dashboard

**Path:** Snapshot file on disk → HTTP server (localhost:8765) → browser → categorisation tree.

**How it works:**
1. User double-clicks `Open Dashboard.cmd` at project root.
2. `.cmd` invokes `powershell -File Dashboard\v3\serve.ps1` which starts an HttpListener on port 8765 serving the project root.
3. Server opens the dashboard URL in the default browser.
4. Browser loads `Dashboard/v3/index.html` (skeleton) + `styles.css` + `category-engine.js` + `app.js`.
5. `app.js` boot: fetches `data/index.csv` → parses → populates date dropdown (newest first).
6. Resolves target date from URL `?date=` param or defaults to newest.
7. Fetches `data/snapshots/YYYY-MM-DD.json` for that date.
8. Flattens `snap.jobs.{new,pending,scheduled,completed}` into a single array, tagging each row with its bucket-source `parent_status`.
9. `CategoryEngine.buildTree(jobs, snapshotAt)` classifies every job into one of 24 leaves + computes SLA + auto-return tags per leaf, then propagates aggregates upward.
10. UI renders: 5 KPI tiles · indented tree with 3-segment SLA bars per row · drill-down side panel on leaf-click.

**Files involved:**
- `Dashboard/v3/index.html` — thin skeleton
- `Dashboard/v3/styles.css` — operational-console aesthetic
- `Dashboard/v3/category-engine.js` — classifier + SLA + tree builder (pure, no DOM)
- `Dashboard/v3/app.js` — UI rendering + date picker + drill-down + CSV parser
- `Dashboard/v3/serve.ps1` — local HTTP server (ASCII-only, UTF-8 BOM — see [ADR-005](decisions.md#adr-005-ascii-only-powershell-with-utf-8-bom))

**Why a server?** Chrome / Edge / Firefox block `fetch()` to `file://` URLs from a page also loaded via `file://` (CORS for security). The HttpListener works around this — it's local-only (binds `localhost:8765`), used purely as a static file server.

### Snapshot pipeline

**Path:** Portal API (with creds) → JSON file + CSV row.

**How it works:**
1. `scripts/pull-daily.ps1` reads `scripts/credentials.json` (username + password, gitignored).
2. POSTs to `/api/v1/auth/login` → receives `access_token` (Bearer JWT-ish opaque token).
3. Calls 5 GETs in sequence (could be parallel; sequential is fine at this volume): `/auth/me`, `/statuses`, and `/jobs?status=...` for each of 4 buckets.
4. Builds a single `snapshot` object with schema `innopower-gwm-snapshot/v1`, full data + provenance metadata (pulledBy, operator, baseUrl, durationMs).
5. Writes `data/snapshots/YYYY-MM-DD.json` (overwrites if same date).
6. Updates `data/index.csv` — removes any row for today's date and appends a fresh one with summary counts.

**Trigger options:**
- Manual: `powershell -ExecutionPolicy Bypass -File scripts\pull-daily.ps1`
- Via `Refresh and Open Dashboard.cmd` at project root (pulls + opens v3)
- Via Windows Task Scheduler — daily at 23:55 recommended (user-installed, not auto-registered)

**Schema versioning:** the `schema` field in each snapshot is `innopower-gwm-snapshot/v1`. If the snapshot shape ever needs a breaking change, bump to `/v2` and have v3 handle both formats. Historical snapshots remain readable forever.

## Component responsibilities

| Component | Owns | Doesn't own |
|---|---|---|
| `Dashboard/v2/payload.js` | UI rendering on portal page; fetch orchestration; bucket-source classification | SLA rule definitions, working-day math (delegates to sla-engine.js) |
| `Dashboard/v2/sla-engine.js` | SLA flag rules (7 rules), working-day math, severity ordering, status hydration | UI, fetch |
| `Dashboard/v3/category-engine.js` | Categorisation tree definitions, classification, SLA tags, tree aggregation | UI, fetch (it's pure) |
| `Dashboard/v3/app.js` | UI rendering, date picker, drill-down, CSV parsing, fetch | Classification rules, SLA rules (delegates to category-engine.js) |
| `Dashboard/v3/serve.ps1` | Local HTTP file serving on port 8765 | Anything else |
| `scripts/pull-daily.ps1` | Login + 5 GETs + write snapshot + update CSV index | Rendering, classification |
| `scripts/diff.html` | Compare two snapshot files manually | Anything realtime |

## Why two separate engines (v2 sla-engine, v3 category-engine)?

Deliberate. v2 and v3 evolve independently. v2's `sla-engine.js` is optimised for the live overlay's "7-rule flag list" UX. v3's `category-engine.js` is optimised for tree-shaped aggregation. They share the same contract clauses as input but the data structures they produce differ.

Trade-off: SLA threshold constants exist in two places (`SLA` in v2's sla-engine.js, `SLA_THRESHOLDS` in v3's category-engine.js). Both trace to the same contract. When the contract is amended, both files need a synchronous edit — see [contract-and-sla.md](contract-and-sla.md) for the single canonical list of values.

## Data flow guarantees

- **Read-only:** every HTTP call to the portal is `GET` except the single `POST /api/v1/auth/login` to get a token. Verified by Network panel inspection (only GETs visible to data endpoints).
- **Idempotent snapshots:** same date input → same output file (overwrites). No incremental state.
- **No portal mutations:** v2's overlay touches no portal DOM nodes; closing the overlay leaves the portal exactly as it was.
- **No browser persistence beyond session:** v3 uses URL `?date=` for state. v2 stores nothing in localStorage/sessionStorage (only reads the JWT for the duration of the overlay).

## Failure modes worth knowing

| Symptom | Likely cause |
|---|---|
| v2 bookmarklet alerts "must be launched from ev.rpdservice.com" | Bookmarklet was clicked while on a different domain. Navigate to portal first. |
| v2 refresh error "ไม่พบ token" | Not logged in to portal. Log in then click the bookmark again. |
| v3 boot screen says "ไม่สามารถอ่าน snapshot YYYY-MM-DD.json ได้ — HTTP 404" | The snapshot file doesn't exist for that date. Pick a different date from dropdown, or run `pull-daily.ps1`. |
| v3 boot error "ไม่สามารถอ่าน data/index.csv ได้" | No pulls have ever succeeded. Run `pull-daily.ps1` for the first snapshot. |
| `Open Dashboard.cmd` shows "cannot bind to port 8765" | Another instance is already running. Either close the other window or change the port in `serve.ps1`. |
| `pull-daily.ps1` exits with HTTP 401 | Credentials in `scripts/credentials.json` are stale or wrong. Update and retry. |
| v2 funnel + heat-strip counts disagree | Either the status hydration logic regressed, or a new status was added to the taxonomy but not the dashboard's leaf map. See [ADR-004](decisions.md#adr-004-status-hydration). |
