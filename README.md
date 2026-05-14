# Setup Dashboard v5 — Portable Bundle

A self-contained copy of both Innopower × GWM dashboards, ready to copy to another Windows machine and run with a double-click.

Bundled on: 2026-05-14
Source contract: **GWMMT2610045** (1 May 2026 – 30 Apr 2027)

---

## ⚠️ SECURITY WARNING — READ BEFORE SHARING

The file `scripts\credentials.json` (if you added it manually — see *Quick start* step 2 below) contains the **real `gwm_headoffice` portal password in plain text**.

- ❌ Do **not** share this folder with anyone outside Innopower.
- ❌ Do **not** upload it to public cloud drives, file-sharing sites, or chat tools.
- ❌ Do **not** commit it to any git repository.
- ✅ If the bundle ever leaves the trusted-machine perimeter, **rotate the portal password immediately**.
- ✅ For transfer, prefer encrypted USB or password-protected zip + out-of-band key.

---

## Quick start (target machine)

1. **Copy the folder.** Unzip / copy `setup_dashboard_v5` anywhere on disk (e.g. `C:\GWM\`, `D:\Dashboards\`, the Desktop). No install, no admin rights required.

2. **Drop in credentials** (one-time):
   - Open `scripts\credentials.example.json` to see the format.
   - Save a copy named `scripts\credentials.json` with the real `gwm_headoffice` username + password.
   - You only need this if you want to refresh data from the portal. Viewing existing snapshots works without it.

3. **View existing data** — double-click one (or both) of:
   - **`Open Operation Dashboard.cmd`** → opens the Thai/EN ops console at `http://localhost:8765` (full SLA breach tracking + categorisation tree).
   - **`Open Executive Dashboard.cmd`** → opens the English exec view at `http://localhost:8766` (five KPI tiles for GWM stakeholders).
   - Both can run **at the same time** — they use different ports.

4. **Refresh data from the portal** — double-click one of:
   - **`Refresh and Open Operation Dashboard.cmd`** — pulls a fresh daily snapshot, then opens the ops dashboard.
   - **`Refresh and Open Executive Dashboard.cmd`** — pulls a fresh daily snapshot, then opens the executive dashboard.

5. **Stop a server** — close the black console window for that dashboard.

---

## What's inside

```
setup_dashboard_v5/
├── README.md                                       (this file)
├── Open Operation Dashboard.cmd                    launcher — ops, port 8765
├── Open Executive Dashboard.cmd                    launcher — exec, port 8766
├── Refresh and Open Operation Dashboard.cmd        pull + ops
├── Refresh and Open Executive Dashboard.cmd        pull + exec
│
├── Dashboard/
│   ├── v3/                                         operation dashboard (Thai/EN)
│   ├── v4-gwm/                                     executive dashboard (EN, port 8766)
│   ├── sla-requirements.html                       contract SLA visual reference
│   └── case-classification-tree.html               classifier reference page
│
├── data/
│   ├── index.csv                                   one row per daily snapshot
│   └── snapshots/                                  YYYY-MM-DD.json — the audit trail
│
├── scripts/
│   ├── pull-daily.ps1                              fetches today's snapshot from portal
│   ├── credentials.example.json                    template (safe to share)
│   └── credentials.json                            ← add this yourself (see step 2)
│
└── design/                                         architecture, SLA, classifier, ADRs
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "PowerShell scripts are disabled" | Execution policy block | Launchers already pass `-ExecutionPolicy Bypass`; if it still fails, right-click the .cmd → Run as administrator. |
| "Port 8765 already in use" | Another instance of the ops dashboard is running | Close the other black console window first. |
| "Port 8766 already in use" | Another instance of the executive dashboard is running | Close the other black console window first. |
| Browser opens but shows "404 not found" | Server is up but `data\snapshots\` is empty | Run a *Refresh and Open …* launcher to pull the first snapshot. |
| Refresh fails with "credentials.json not found" | Step 2 above was skipped | Copy `credentials.example.json` → `credentials.json` and fill in real values. |
| Firewall prompt on first run | Windows asking permission for the local server | Allow access on **Private networks only**. The server only binds to `localhost`. |

---

## Read-only constraint (do not change)

The dashboards and `pull-daily.ps1` are **strictly read-only** against `ev.rpdservice.com` — only HTTP `GET` against:
- `/api/v1/auth/login`
- `/api/v1/auth/me`
- `/api/v1/jobs`
- `/api/v1/statuses`

No POST/PUT/PATCH/DELETE. The portal is production for live installations; any modification could break real EV-charger jobs.

---

## Reference docs

See `design/README.md` for the full architecture, contract clauses, SLA rules, categorisation tree, and the ADR log explaining why each choice was made.
