# Contract & SLA Rules

> Single source of truth for all SLA thresholds. **Every flag rule must trace back to a clause here.** The signed contract PDF lives at `Contracted Signed Version/`.

## Verbatim contract text — Installation Service Response Time (page 5–6)

These are the operative SLA clauses, copied directly from the signed contract:

> **§1.** Party B shall **contact the user within twenty-four (24) hours** upon receipt of the installation service work order, confirm the installation order and user information, and make an appointment for on-site investigation as described in Attachment 2.
>
> **§2.** Party B shall **conduct on-site investigation within three (3) working days** upon receipt of the service work order. In case of customer inconvenience or other special reasons, Party B shall file with GWM for record, **the timeline shall be extended accordingly and Party B shall not be liable for such delay**.
>
> **§3.** […] Party B shall work out an installation and construction plan for charging piles and **complete the installation within three (3) working days upon approval of the users**.

Plus Installation Technical Specification §5 (page 7) — the force-majeure clause:

> Party B shall not be liable for any delay or failure […] due to events beyond its reasonable control, including but not limited to accidents, vehicle breakdown, traffic incidents, adverse weather conditions, or any other force majeure events. **In such circumstances, the relevant timelines shall be extended for a period equivalent to the duration of such delay.**

**Note for §2 and §5 — escape valves not yet modelled in the dashboards.** Both clauses extend the SLA clock when (a) the customer is unavailable or (b) force majeure intervenes. The dashboards currently do not have a way to mark a job as "filed for extension" — see ADR-012 for the deferred implementation.

## Contract identification

- **Contract ID:** GWMMT2610045
- **Signed:** 1 May 2026
- **Term:** 2026-05-01 → 2027-04-30
- **Parties:** Innopower Co., Ltd. (Party A — owner of the GWM EV charger programme) × EVW Service (Party B — installation operator)
- **Innopower's role here:** Party A's oversight arm — read-only monitoring against SLA, no operational write-back.

## Three primary SLA rules (Installation Service Response Time)

These are the operational deadlines that case status must hit. All three apply to *active* cases. Once a case is in `InstallationCompleted`, these get evaluated retrospectively (see "Delivered-stage SLA" below).

### §1 — Contact within 24 hours

- **Source:** Installation Service Response Time §1
- **Trigger:** A new work order lands in the portal (status: `NewJob`, no `assign_date` or `Status` yet).
- **Deadline:** `createdAt + 24h`
- **Anchor field:** `job.createdAt`
- **Closed by:** Any forward progress — typically `assign_date` being set or the case being picked up by EVW operator (`Status` populated).

### §2 — Survey/Site visit within 3 working days

- **Source:** Installation Service Response Time §2
- **Trigger:** Case is in `InitialCustomer` stage but no confirmed install date yet.
- **Deadline:** `createdAt + 3 working days`
- **Anchor field:** `job.createdAt`
- **Closed by:** `confirm_setup_date` being set — that's the milestone marker that customer + EVW have agreed on a date.

### §3 — Install within 3 working days of customer approval

- **Source:** Installation Service Response Time §3
- **Trigger:** Case is in `InstallationScheduled` stage with a `confirm_setup_date`.
- **Deadline:** `confirm_setup_date + 3 working days`
- **Anchor field:** `job.confirm_setup_date` (fallback to `assign_date`, then `createdAt`)
- **Closed by:** `delivery_date` being set.

## Auxiliary rules

### Auto-return at 60 days (Status taxonomy id=11)

- **Source:** Status taxonomy entry id=11 — `[คืนงานสำหรับแอดมิน] ลูกค้าไม่พร้อมติดตั้งเกิน 2 เดือน`
- **Trigger:** Any active (non-delivered) case where `now - createdAt > 60 days`.
- **At-risk threshold:** Our dashboards flag at **50 days** to give 10 days of warning to act before the case auto-returns.
- **Severity escalation:** 50–58 days = high; 58–60 days = critical; >60 days = case has auto-returned (handled by the portal).
- **Implementation:** v2 shows this as a flag rule. v3 shows it as an "auto-return" overlay badge on every node that contains qualifying cases.

### False-confirm audit (Install Service Management Platform §5)

- **Source:** Install Service Management Platform §5 — 5% monthly fee deduction for confirmed installations without customer verification.
- **Trigger:** Case marked `InstallationCompleted` where `workingDays(confirm_setup_date → delivery_date) < 1` — i.e. confirmation and delivery happened on the same working day, suggesting the confirm step may have been formalities rather than real customer agreement.
- **Why we flag it:** Innopower's audit obligation. If false confirms are systemic, the contract triggers a 5% monthly deduction. Dashboard surfaces these for manual review.
- **In v3:** these cases land in leaf `K4.B` ("Suspicious confirm") regardless of other metrics.

### Issue tracking (Service Quality Assessment §2(b)(f))

- **Source:** Service Quality Assessment §2(b) and (f) — penalties for unresolved customer issues and quality failures.
- **Trigger:** `status.name === 'งานติดปัญหา'` — case explicitly flagged as having an issue by EVW.
- **Severity:** v2 surfaces these as a flag (medium severity baseline, escalates with age). v3 routes them to `K*.B.*` leaves based on root-cause detail.

## SLA classification model — v3's three-bucket scheme

v3 expresses every leaf's SLA status as a 3-way split (the dashboard shows a horizontal coloured bar). The bucket depends on **lateness**, measured in the same unit as the deadline (see "Lateness measurement" below):

| Bucket | Range (calendar-hour SLAs) | Range (working-day SLAs) | UI colour |
|---|---|---|---|
| **In SLA** | `lateness ≤ 0` | `lateness ≤ 0` | green `#15803d` |
| **Medium breach** | `0 < lateness ≤ 24h` | `0 < lateness ≤ 1 working day` | amber `#a16207` |
| **Critical breach** | `lateness > 24h` | `lateness > 1 working day` | red `#b91c1c` |

## Lateness measurement (ADR-012)

The contract specifies deadlines in two different units:
- **§1 Contact** — 24 calendar hours
- **§2 Survey / §3 Install** — 3 working days

The contract is silent on how to measure lateness *past* the deadline. The project's interpretation: **lateness is measured in the same unit as the deadline.**

- Contact-SLA lateness → calendar hours
- Survey / Install-SLA lateness → working days

**Working day** = Monday–Friday (weekday). **No public holidays are subtracted** — this is deliberately conservative per Innopower's call until a definitive Thai holiday calendar is published; see `THAI_HOLIDAYS` constant.

**Concrete example.** Case `id=4080` had a Friday `confirm_setup_date` deadline and was confirmed Monday morning. Under the old "calendar-hour lateness" rule it appeared 48 hours late = Critical. Under the working-day rule it's 1 working day late = Medium. The latter matches operational intuition (the customer confirmed on the very next working day after the deadline, weekends excluded).

## Delivered-stage (K4) SLA — retrospective worst-case

Completed cases (`InstallationCompleted`) still get an SLA tag, computed retrospectively across all three milestones that the case traversed:

```js
worstOf([
  contact_lateness = assign_date - (createdAt + 24h),
  survey_lateness  = confirm_setup_date - (createdAt + 3wd),
  install_lateness = delivery_date - (confirm_setup_date + 3wd),
])
```

The case's K4 tag = the worst (most-late) of these three. If a timestamp is missing, that milestone is skipped. If all are missing, default `ok`.

**Why "retrospective worst-case":** when reporting to GWM on monthly SLA compliance, the question is "did this case breach any SLA along its lifecycle?" — not "is it currently late?" (it isn't; it's done). The worst-case tag lets a single number describe the worst breach for monthly audit.

## v2 flag rules (7 total)

v2's `sla-engine.js` produces flags using these 7 rules. Each maps back to one or more contract clauses. Severity boundaries align with the lateness rule above (ADR-012).

| Rule ID | TH label | Trigger | Severity | Contract ref |
|---|---|---|---|---|
| `CONTACT_AT_RISK` | ใกล้ครบ 24 ชม. | `stage=NewJob & now − createdAt > 18h` (but ≤ 24h) | medium | Response §1 |
| `CONTACT_OVERDUE` | ติดต่อลูกค้าเกิน 24 ชม. | `stage=NewJob & calendar-late > 0h` | high; critical if calendar-late > 24h | Response §1 |
| `SURVEY_OVERDUE` | สำรวจเกิน 3 วันทำการ | `stage=InitialCustomer & wd-late > 0 & no confirm_setup_date` | high; critical if wd-late > 1 | Response §2 |
| `INSTALL_OVERDUE` | ติดตั้งเกิน 3 วันทำการ | `stage=InstallationScheduled & wd-late > 0 & no delivery_date` | high; critical if wd-late > 1 | Response §3 |
| `AUTO_RETURN_RISK` | เสี่ยงคืนงาน (60 วัน) | active & `age_days > 50` | high; critical if >58d | Status #11 |
| `ISSUE_FLAGGED` | งานติดปัญหา | `status.name === 'งานติดปัญหา'` | medium | QA §2(b)(f) |
| `FALSE_CONFIRM_AUDIT` | สงสัย Confirm เท็จ | `stage=InstallationCompleted & workingDays(confirm → delivery) < 1` | critical | Platform §5 |

Where:
- **`wd-late`** = `workingDaysBetween(createdAt or anchor, now) − SLA_threshold_wd` — the number of working days past the SLA deadline.
- **`calendar-late`** = `now − deadline` measured in calendar hours.

## Working-days calculation

Both engines (`v2/sla-engine.js` and `v3/category-engine.js`) implement working-days as **Mon–Fri only**, with public holidays declared in a `THAI_HOLIDAYS` set.

**The set is currently empty.** When the user defines an authoritative holiday calendar, populate both files synchronously. Format: ISO date strings (`'2026-05-01'`).

Working-day examples:
- Mon → Tue = 1 working day
- Fri → Mon = 1 working day (Sat + Sun excluded)
- Mon → following Mon = 5 working days
- `addWorkingDays(Friday, 3)` = end-of-day Wednesday (next week)

## Penalty escalation (Service Quality Penalties §3)

The contract's penalty chain (not currently implemented as dashboard logic, but documented here for future enforcement):

(a) Written warning → (b) Monetary penalty per incident / delay duration / % of fees → (c) Service-fee deduction → (d) Temporary suspension.

Party B (EVW) may file objections within 3 days before any penalty takes effect — useful for force-majeure exemption claims. Force majeure cases per §Installation Technical Specification §5 should be filed in the job's `Note` to defer SLA timeline.

## When the contract changes

If GWM and EVW amend the contract:

1. Update this document with the new clause reference and threshold.
2. Update `Dashboard/v2/sla-engine.js` — `SLA` constants block + `RULE_LABELS` if names changed.
3. Update `Dashboard/v3/category-engine.js` — `SLA_THRESHOLDS` block.
4. Rebuild the v2 bookmarklet so the updated rules are deployed.
5. Existing snapshots remain valid — historical analysis still reflects the rules that were in force at that time. Consider tagging the snapshot schema version if the change is substantial.
