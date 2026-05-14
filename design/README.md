# Platform Design Docs

> **Audience.** Anyone — human or AI — picking up this project. If you've moved to a new computer and want to continue working, start here.

## What's in this folder

This folder is the **single source of truth** for *why and how* this platform works. The code in `Dashboard/` and `scripts/` tells you *what* it does; these documents tell you *why it does it that way*.

| Document | Read this when… |
|---|---|
| [architecture.md](architecture.md) | You need to understand how the three dashboards relate, where data flows, and what each component does. |
| [contract-and-sla.md](contract-and-sla.md) | You're working on SLA flag rules, breach thresholds, or contract compliance. |
| [../Dashboard/sla-requirements.html](../Dashboard/sla-requirements.html) | You want the **visual restatement** of the same rules — lifecycle ribbon, severity ladders, auto-return clock. Open in a browser; shareable with non-technical stakeholders. |
| [api-reference.md](api-reference.md) | You're touching code that talks to `ev.rpdservice.com` (the portal API) or referencing the 19-status taxonomy. |
| [categorisation-tree.md](categorisation-tree.md) | You're changing v3's dichotomous tree, leaf definitions, or how cases are classified. |
| [decisions.md](decisions.md) | You're about to change an architectural choice, or you want to know why a previous choice was made (so you don't reinvent the same wheel). |

## 30-second project summary

Innopower oversees GWM's EV-charger installation programme. The actual installation work is done by EVW Service, who run the operational portal at `ev.rpdservice.com`. Innopower's job is to **monitor and flag SLA breaches** — but never to write back to the portal.

Three dashboards exist for three workflows:

- **v2** — live overlay injected into the portal page via bookmarklet. Best for real-time ops monitoring with a fresh-data Refresh button.
- **v3** — offline-capable dashboard reading from local daily snapshots. Best for historical analysis, audit trail, and the categorisation tree view.
- A daily **snapshot pipeline** (`scripts/pull-daily.ps1`) feeds v3 and creates the historical record.

## Glossary

| Term | Meaning |
|---|---|
| **Portal** | `ev.rpdservice.com` — the operational platform run by EVW Service where job assignments and status updates happen. |
| **Job** | A single customer's installation case. Has a code (`RO-2603xxxxx`), a customer, a car, an address, and traverses through stages. |
| **Stage** / `parent_status` | One of: `NewJob` (Intake), `InitialCustomer` (Contacting), `InstallationScheduled` (Scheduled), `InstallationCompleted` (Delivered). |
| **Status** / `status_customer_id` | A finer-grained classification within a stage. 19 distinct statuses total. See `api-reference.md`. |
| **งานติดปัญหา** | "Issue flagged" — a status name used inside stages 2 and 3 to indicate the case has a problem. The `detail` field tells you the root cause. |
| **SLA** | Service Level Agreement, defined in the contract. Three operational thresholds (24h contact, 3-working-days survey, 3-working-days install) plus a 60-day auto-return cutoff. |
| **Snapshot** | A single pull of all current portal data, stored at `data/snapshots/YYYY-MM-DD.json`. Immutable once written. |
| **Bookmarklet** | A bookmark whose URL is `javascript:...` — when clicked while on the portal, it injects v2's dashboard as a same-origin overlay. |
| **Auto-return** | A portal mechanism that returns a job to admin after 60 days of inactivity. We flag at 50 days to give time to act. |

## Working principles

1. **Read-only against the portal.** Hard constraint. See [decisions.md ADR-001](decisions.md#adr-001-read-only-against-the-portal).
2. **Snapshot data is canonical for v3.** Once a snapshot is written, the dashboard renders it deterministically. Don't modify historical snapshots — they're the audit trail.
3. **Self-contained dashboards.** v2 and v3 don't import from each other. Either can be deleted without breaking the other.
4. **No build step, no npm.** All code runs in the browser via vanilla `<script>` tags, or in PowerShell directly. Easy to share, easy to audit.
5. **Contract is the spec.** Any SLA rule must trace back to a specific clause in `GWMMT2610045`. See [contract-and-sla.md](contract-and-sla.md).

## Contributing or extending

When adding a new feature:

1. **If it changes how cases are classified** → update [categorisation-tree.md](categorisation-tree.md) first, then implement in `Dashboard/v3/category-engine.js`.
2. **If it changes an SLA rule** → update [contract-and-sla.md](contract-and-sla.md) first with the contract reference, then implement in both `Dashboard/v2/sla-engine.js` and `Dashboard/v3/category-engine.js` (no shared module — by design).
3. **If it changes data flow** → update [architecture.md](architecture.md).
4. **If you make a non-trivial architectural choice** → add an ADR entry to [decisions.md](decisions.md). Future readers (including future-you) will thank you.

## What's *not* in here

These docs describe **design**, not **operations**. For operational matters:

- Day-to-day usage instructions → [CLAUDE.md](../CLAUDE.md) at project root
- Contract scan → [Contracted Signed Version/](../Contracted%20Signed%20Version/)
- Live state of the system → check the snapshots in [data/snapshots/](../data/snapshots/) or open a dashboard
