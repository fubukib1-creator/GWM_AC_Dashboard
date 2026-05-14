# Architecture Decision Records (ADRs)

> Captures the non-obvious decisions and their reasoning. If you're about to change one of these, read why it was decided this way first — there's usually a real reason buried in the trade-off.

Format: each ADR has Context (what problem), Decision (what we chose), Rationale (why), and Consequences (what follows from it).

---

## ADR-001 — Read-only against the portal

**Context.** `ev.rpdservice.com` is the production operational platform run by EVW. Real technician dispatches, customer notifications, and SLA-bearing state changes flow through it. Innopower's relationship with EVW is *oversight*, not *operations*.

**Decision.** No code in this project will issue any HTTP method other than `GET` to portal endpoints, except the single `POST /api/v1/auth/login` (which mints a session token without changing portal data). No DOM mutations of portal pages either.

**Rationale.**
- A bug that flips a case from "scheduled" back to "pending" would cause a real technician's truck-roll. Cost is high; benefit of write access is low (we don't need it).
- Innopower has zero authority to update EVW's records — that's EVW's job per contract.
- Audit story stays clean: "we only read."

**Consequences.**
- v2's bookmarklet is purely additive — overlay div is appended, no portal nodes touched.
- Refresh button can't mark a case resolved or assign a mechanic. Users must do that in the portal directly.
- Excel/CSV exports of dashboard data are fine (data is read out, not written in).
- Any future feature involving write-back to the portal requires renegotiation with EVW and contract review.

---

## ADR-002 — Inline PowerShell instead of running .ps1 files during development

**Context.** Building the v2 bookmarklet involves reading `sla-engine.js` + `payload.js`, URL-encoding, and writing the result into `bookmarklet.html`. The natural pattern is a `.ps1` script that does this. But the user's Windows policy restricts `.ps1` execution by file (Restricted/RemoteSigned), and `-ExecutionPolicy Bypass` is blocked by a higher-level policy.

**Decision.** Keep `Dashboard/v2/build-bookmarklet.ps1` in the repo for documentation/reference, but during development, run the build logic **inline** via a single `PowerShell` tool call (commands at the prompt, not a file).

**Rationale.**
- Inline commands aren't subject to file-execution policy — they run as ad-hoc prompt input.
- Documentation value of the .ps1 file remains (engineers can read what the build does).
- Avoids per-developer setup of execution policy or relying on workarounds.

**Consequences.**
- The PowerShell tool call to "rebuild bookmarklet" duplicates the .ps1's logic inline. They must stay in sync if either is edited.
- If the user wants to schedule the bookmarklet build via Task Scheduler, they'd need to either enable script execution for that file specifically or wrap the inline form in a `.cmd`.
- The launchers (`Open Dashboard.cmd`, `Refresh and Open Dashboard.cmd`) use `powershell -ExecutionPolicy Bypass -File ...` — that *works* for the user's own profile when they double-click. The block was specifically on the Claude harness running it.

---

## ADR-003 — Bucket-source over embedded Status fields

**Context.** When fetching `/api/v1/jobs?status=InstallationScheduled`, some returned rows have their embedded `Status.parent_status` field set to `InitialCustomer` (the wrong stage). Cause: a join projection quirk on the portal side. Result: the funnel/categorisation logic was putting these jobs in the wrong stage.

**Decision.** When the dashboard fetches data, tag each row with `parent_status = <the bucket that returned it>` — *before* any classification logic runs. Ignore the embedded `Status.parent_status` from the API.

**Rationale.**
- The bucket source is what the portal's own tabs use to display the case. Aligning our classification with the portal's display keeps users' mental model intact.
- The embedded field is technically "the join lookup says" — but if the portal disagrees with its own join lookup, we trust the operational decision (the tab placement) over the metadata.

**Consequences.**
- Both v2's `payload.js` and v3's `app.js` have a flatten/tag step at fetch time.
- `scripts/pull-daily.ps1` doesn't pre-tag — the v3 dashboard re-derives at load time from the bucket structure in the snapshot.
- If the portal ever fixes the inconsistency, this code still works (the tag becomes redundant but not harmful).
- Documented in `api-reference.md` under "Known data quality issues — Q2".

---

## ADR-004 — Status hydration from taxonomy

**Context.** Similar issue to ADR-003 but on the `Status.id` field. Some rows return `Status.status` (the name) and `Status.detail` populated but `Status.id` empty/null. Heat-strip cells were under-counting because the count loop used `j.status.id` as the bucket key.

**Decision.** After fetching but before rendering, run a hydration pass: for any job with `status_customer_id` set but a partial `Status` object, backfill `Status.id`, `Status.name`, `Status.detail`, `Status.parent` from the `/statuses` taxonomy lookup. Purely additive — never overwrites populated values.

**Rationale.**
- `status_customer_id` on the job row is the authoritative pointer (verified across many rows). Use it to repair the embedded `Status`.
- Doing this once at boot is cheaper than defensively checking everywhere downstream.
- Backwards-compatible: when the portal fixes the join, the hydration becomes a no-op.

**Consequences.**
- `sla-engine.js` exposes `hydrateJobsFromTaxonomy(jobs, statuses)`.
- `payload.js`'s `refresh()` calls it right after the bucket-tagging step.
- v3 doesn't need this because its classification uses `status_customer_id` directly — no reliance on `Status.id`.
- Documented in `api-reference.md` under "Known data quality issues — Q1".

---

## ADR-005 — ASCII-only PowerShell with UTF-8 BOM

**Context.** Initial `serve.ps1` had em-dashes (`—`) and box-drawing characters in comments and `Write-Host` strings. Windows PowerShell 5.1 reads `.ps1` files as ANSI (Windows-1252) by default unless they have a BOM. The em-dash UTF-8 byte sequence (`0xE2 0x80 0x94`) got mis-decoded, breaking the parser at unrelated lines and producing confusing cascading errors.

**Decision.** All PowerShell scripts must use **ASCII-only characters** AND be saved with **UTF-8 BOM**. Two belt-and-braces measures because either alone has gaps.

**Rationale.**
- ASCII-only avoids the encoding issue entirely.
- UTF-8 BOM is a hint to PowerShell 5.1 to read the file as UTF-8 (it respects BOM).
- Together: belt and braces. If a developer forgets one safeguard, the other catches them.

**Consequences.**
- Don't use `—` (em-dash) or `–` (en-dash) — use `--` (two ASCII hyphens) in PowerShell strings.
- Don't use box-drawing characters (`─ ─ │` etc.) — use ASCII alternatives (`- _ |`).
- When saving from an editor, ensure UTF-8 BOM (or use PowerShell `[System.IO.File]::WriteAllText` with `New-Object System.Text.UTF8Encoding($true)` — the `$true` enables BOM).
- This rule does NOT apply to PowerShell that runs inline as a tool-call argument — that's not a file, encoding doesn't apply.
- HTML, CSS, JS, JSON files can freely use UTF-8 without BOM. The rule is PowerShell-specific.

---

## ADR-006 — v3 reads local snapshots, not the live portal

**Context.** v2 already fetches live data. Why duplicate effort with v3?

**Decision.** v3 is local-snapshot-driven. Reads only from `data/snapshots/*.json` and `data/index.csv`. Never calls the portal API.

**Rationale.**
- **Single source of truth for analysis.** When generating monthly SLA reports, you want a stable artifact ("here's the data we used") — not "we re-fetched, here's what the portal said this afternoon."
- **Historical replay.** v3 can render any past day's snapshot. v2 can't time-travel.
- **Offline.** Snapshots can be reviewed without network access — useful for travel, demos, audit walkthroughs.
- **Schema stability.** If the portal API changes shape, v3 keeps working on historical data; only `pull-daily.ps1` needs updating.
- **Decoupling.** v3 development doesn't depend on having a working portal session — anyone with a snapshot can develop.

**Consequences.**
- v3 needs a daily pull pipeline to stay fresh. Existing `pull-daily.ps1` covers this.
- v3 needs a local HTTP server (`serve.ps1`) because Chrome blocks `file://` fetches — see ADR-007.
- v3 and v2 may show slightly different numbers if v2 is refreshed while v3 is displaying an older snapshot. That's expected; the snapshot date is shown prominently in v3's header.

---

## ADR-007 — Local HTTP server for v3 (not direct file://)

**Context.** v3 needs to `fetch('../../data/index.csv')` and `fetch('../../data/snapshots/...json')`. When `index.html` is opened via `file://` in Chrome (or Edge or modern Firefox), these fetches fail with CORS errors — browsers treat each `file://` URL as a unique origin and block cross-origin reads.

**Decision.** Ship a small `serve.ps1` that runs a `System.Net.HttpListener` on `localhost:8765` serving the project root. The dashboard is accessed via `http://localhost:8765/Dashboard/v3/index.html`. The launcher `.cmd` files start the server and open the browser.

**Rationale.**
- Workarounds for `file://` (Chrome flag `--allow-file-access-from-files`, Edge equivalents) are user-hostile and unsafe to recommend.
- HttpListener is built into Windows. No installer, no dependencies.
- `localhost`-only binding (`http://localhost:8765/` prefix, not `http://+:8765/`) means it's not accessible from other machines.
- Operations team can start it with a double-click; close the window to stop it.

**Consequences.**
- The launcher `.cmd` files are now required for v3 — direct double-click of `index.html` doesn't work for data loading.
- Port collision possible — if 8765 is in use, the launcher exits with an error. User can change the port in `serve.ps1` and the path in `Open Dashboard.cmd`.
- The server is a tiny static file server — no auth, no caching, no compression. Adequate for local single-user use.
- Could be replaced by Python's `python -m http.server` or `npx serve` if the user prefers — but those add a dependency. PowerShell native is the lowest-friction choice on Windows.

---

## ADR-008 — Two independent SLA engines (no shared module)

**Context.** Both v2 (`sla-engine.js`) and v3 (`category-engine.js`) need SLA threshold constants and working-day math. Natural impulse: extract to a shared module.

**Decision.** Each dashboard owns its own engine. ~80 lines of date helpers and threshold constants are duplicated between `Dashboard/v2/sla-engine.js` and `Dashboard/v3/category-engine.js`.

**Rationale.**
- **Self-contained dashboards** is a stated project value. Either can be deleted without breaking the other.
- The engines aren't identical in shape — v2 produces a flag list, v3 produces a tree. A "shared module" would devolve into a heap of unrelated helpers.
- The duplication is small (~80 lines) and changes rarely (only when contract thresholds change).
- v2 is shipped as a bookmarklet — bundling a shared module from `../v3/` would couple the build pipeline to v3.

**Consequences.**
- SLA threshold constants must be updated in two files when the contract changes.
- `contract-and-sla.md` is the canonical reference — both files should match it.
- If the duplication ever grows past ~150 lines or starts drifting subtly, reconsider.

---

## ADR-009 — Bookmarklet for v2 instead of browser extension

**Context.** v2 must run *on* the portal page (same-origin) to access the API without CORS issues. Options: bookmarklet, Tampermonkey userscript, custom browser extension.

**Decision.** Bookmarklet — `javascript:` URL drag-installed into the bookmark bar.

**Rationale.**
- **No install friction.** Drag a link, done. Anyone with admin-blocked extension permissions can still use it.
- **No marketplace approval.** Innopower-internal tool; no Chrome Web Store overhead.
- **Audit-friendly.** The full source is in `bookmarklet.html` — readable, no compiled binary.
- **Same-origin for free.** When clicked on ev.rpdservice.com, the JS runs in that page's context with full access to localStorage + cookies.

**Consequences.**
- Bookmark URL is ~175 KB — fits Chrome and Edge (which allow ~2 MB) but exceeds Firefox's ~64 KB limit. Firefox users need Tampermonkey instead (deferred).
- Every code change requires rebuilding and re-dragging. Adoption barrier for changes is slightly higher than an auto-updating extension.
- If Innopower's team grows beyond ~3 users and updates become frequent, consider hosting the payload at an Innopower-internal URL and shipping a tiny loader bookmarklet that fetches it. Deferred until the use case appears.

---

## ADR-010 — ISO date format for snapshot filenames

**Context.** Started with `YYYYMMDD.json` (compact, lexicographic sort) but the CSV index stored `YYYY-MM-DD` (ISO). The mismatch caused 404s in v3 when the dashboard built the snapshot URL from the CSV's date string.

**Decision.** Standardise on **ISO format (`YYYY-MM-DD.json`)** for snapshot filenames. CSV index uses the same. v3's URL `?date=` param also accepts the same. (Legacy compact `?date=YYYYMMDD` is still parsed for backward compatibility on old bookmarks.)

**Rationale.**
- One format across the whole stack means no mental translation when looking at files vs. URLs vs. CSV.
- ISO dates sort lexicographically as well as compact ones do (just with extra `-` characters).
- Excel and humans read `2026-05-12` more readily than `20260512`.

**Consequences.**
- Existing `20260512.json` was renamed to `2026-05-12.json`.
- `pull-daily.ps1`'s `$dateTag = Get-Date -Format 'yyyy-MM-dd'`.
- v3's `app.js` uses `date` directly without dash-stripping.

---

## ADR-011 — `.cmd` launchers, not `.exe`

**Context.** User asked for a double-click launcher. Options: `.cmd` / `.bat` file, compiled `.exe` (via PS2EXE).

**Decision.** Two `.cmd` files at project root: `Open Dashboard.cmd` (fast, opens existing snapshots) and `Refresh and Open Dashboard.cmd` (pulls fresh + opens).

**Rationale.**
- **Transparency.** `.cmd` files are plain text. Anyone can read them in Notepad to verify what they do. Important for a tool that uses portal credentials.
- **No SmartScreen warnings.** Compiled `.exe` (unsigned) triggers SmartScreen on first run; users have to "more info → run anyway". `.cmd` files don't.
- **No build step.** No PS2EXE module to install, no compilation, no versioned binary to ship.
- **Editable.** Operations team can adjust paths or args without recompiling.

**Consequences.**
- If Innopower ever wants to distribute the dashboard widely (to vendor partners, etc.), a signed `.exe` becomes a cleaner story. Documented as a future option.
- The `.cmd` files invoke `powershell.exe -ExecutionPolicy Bypass -File ...` which the user's environment permits. Tested working.

---

## ADR-012 — Lateness measured in same unit as deadline; working-days = Mon-Fri only

**Context.** Case `4080` surfaced an inconsistency in the SLA logic: the *deadline* for §2 (Survey) and §3 (Install) is computed in working days (correctly skipping weekends), but the original *lateness* measurement that drove the medium/critical split was in calendar hours. Net effect: a customer confirming Monday morning after a Friday survey deadline appeared 48 calendar hours late → Critical, even though only the weekend had passed (0 working hours).

The signed contract (GWMMT2610045 §Installation Service Response Time, page 5–6) specifies:
- §1 Contact within **24 hours** (calendar)
- §2 Survey within **3 working days**
- §3 Install within **3 working days** of customer approval

It is silent on how to measure lateness past these deadlines.

**Decision.** Lateness is measured in the **same unit as the deadline**:
- Contact SLA (calendar-hour deadline) → lateness in calendar hours. Medium ≤ 24h late, Critical > 24h.
- Survey + Install SLAs (working-day deadlines) → lateness in working days. Medium ≤ 1 working day late, Critical > 1 working day.

"Working day" = **Monday–Friday only** (weekday). No public-holiday calendar applied; `THAI_HOLIDAYS` set in both engines remains empty.

**Rationale.**
- **Contract-consistent.** Measuring deadlines in one unit and lateness in another is internally inconsistent. Aligning units removes the ambiguity.
- **Operational fairness.** A Monday-morning action after a Friday-end-of-day deadline is operationally "first working moment after deadline" — natural to call that 1 working day late, not 2-3 days late.
- **Conservative on holidays.** Per Innopower's call: Mon-Fri is the simplest defensible interpretation. Adding holidays would *shrink* the working-day count, making EVW's effective SLA tighter — that should not be applied unilaterally without an authoritative published calendar.
- **Empirical validation.** Case 4080 (Fri 5-08 deadline, Mon 5-11 confirm) now correctly tags Medium (1 wd late) instead of Critical (48h calendar). Matches operational intuition.

**Consequences.**
- Both engines updated:
  - `Dashboard/v3/category-engine.js` — `computeSLA` for K2 + K3 active stages and Survey + Install milestones of K4 retrospective uses `workingDaysLate(deadline, action)`.
  - `Dashboard/v2/sla-engine.js` — `SURVEY_OVERDUE` and `INSTALL_OVERDUE` use `wdLate = workingDays(anchor → now) − SLA_threshold`. New constant `BREACH_CRITICAL_WD_LATE: 1`. Old constants `SURVEY_CRITICAL_WD` and `INSTALL_CRITICAL_WD` removed.
- v3 `computeSLA` now returns `{tag, rule, deadline, latenessWd}` for working-day rules instead of `{tag, rule, deadline, lateness}`. UI updated (`formatLateness` helper in `app.js`) to render whichever is present.
- v2 bookmarklet rebuilt (183,616 chars). Users must re-drag from `Dashboard/v2/bookmarklet.html` to pick up the new logic.
- Historical snapshots in `data/snapshots/` are **unchanged**. The engine computes SLA tags on read; old snapshots will retroactively show different tags when viewed in the updated v3 — that's correct behaviour (the contract reading is now consistent, not the data).
- Documented in `design/contract-and-sla.md` with verbatim contract quotes and the lateness rules table.

**Open follow-up (deferred per user).** The contract's §2 customer-inconvenience clause and Technical Spec §5 force-majeure clause both extend SLA deadlines. The dashboards don't yet model "filed for extension" — every late case is flagged regardless. Worth implementing once Innopower has a written policy on what counts as a qualifying inconvenience / force-majeure event. Will require a side-channel record (the portal has no `force_majeure_filed_at` field) — possibly a separate `data/exemptions.csv` plus engine logic to suppress flags for matched job IDs.

---

## When to add a new ADR

A new decision deserves an ADR if it:

- **Reverses a prior choice** (e.g. we decide to abandon bookmarklets for an extension)
- **Has non-obvious trade-offs** (e.g. "duplicate this code instead of sharing")
- **Constraints future work** (e.g. "no live API access from v3 ever")
- **You'd otherwise reinvent in 6 months** when you've forgotten why

A new decision does NOT deserve an ADR if it's a routine implementation detail or a styling/naming choice with no real alternatives.
