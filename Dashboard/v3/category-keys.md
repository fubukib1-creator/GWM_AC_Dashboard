# v3 Dashboard — Case Categorisation Keys (DRAFT v2)

> Working spec for the dichotomous-key tree. **User decisions Round 1 locked.** Pending answers on 3 remaining items before final freeze.

## User decisions locked

| Question | Choice |
|---|---|
| Tree shape | **Multi-way throughout** (no forced binary) |
| L2 detail | **Split further** — `K2.A` and `K3.A` show their sub-statuses |
| Cannot-contact issues | **Keep separate** — wrong# and no-answer as own leaves |
| Auto-return clock | **Overlay badge** — tree unchanged; show `⚠ auto-return: N` badge on any node containing cases >50d old |
| K4 SLA computation | **Retrospective worst-case** — check Contact (24h), Survey (3wd), Install (3wd of confirm); worst breach wins |
| Snapshot scope | **Most recent single snapshot**, with a date-picker dropdown for retrospective viewing |
| Leaf drill-down | **Job list table** — code, customer, age, SLA tag (no time-spine / geo / team splits in v3 initial scope) |

## Data source

Local JSON snapshots at `data/snapshots/YYYYMMDD.json`, produced by `scripts/pull-daily.ps1`. Each snapshot contains 4 bucketed job lists (`new`, `pending`, `scheduled`, `completed`) plus the 19-status taxonomy.

## The two orthogonal dimensions

Every case is classified along **two independent axes**:

1. **Dichotomous key path** — *what kind of case is this?* (the tree)
2. **SLA status** — *is it on time or breached?* (a 3-way slice across every leaf)

A leaf in the tree therefore reports counts like `in-SLA · medium-breach · critical-breach`.

---

## Dimension 1 — Dichotomous Key Tree

### Level 1 — Stage (4-way fork)

Determined by the bucket the snapshot pulled the job from. Same source-of-truth as v2's funnel.

| Key | Label (TH) | Label (EN) | Source bucket |
|---|---|---|---|
| `K1` | รับงาน | Intake | `jobs.new` |
| `K2` | ระหว่างติดต่อ | Contacting | `jobs.pending` |
| `K3` | ระหว่างติดตั้ง | Scheduled | `jobs.scheduled` |
| `K4` | ส่งเสร็จแล้ว | Delivered | `jobs.completed` |

### Level 2 — Action State (varies per K1 branch)

> **Note (locked decisions applied):** SLA-style age splits have been moved *out* of the tree — they live in the orthogonal SLA dimension. The tree only describes case **type**, not timing.

**K1 รับงาน · further split:** *(by assignment status — type, not age)*
- `K1.A` Unassigned — no `assign_date`, just landed in the queue
- `K1.B` Assigned, awaiting first contact — `assign_date` is set, mechanic team picked up, but no Status row yet

**K2 ระหว่างติดต่อ · further split:**
- `K2.A` Active engagement (`status.name ∈ {นัดสำรวจ, ติดต่อลูกค้าแล้ว}`) — *split further per decision*:
  - `K2.A.i`  นัดสำรวจ — survey appointment booked
  - `K2.A.ii` ติดต่อลูกค้าแล้ว — contacted, awaiting customer next step
- `K2.B` Issue flagged (`status.name = งานติดปัญหา`) — descend to K2.B.* below

**K3 ระหว่างติดตั้ง · further split:**
- `K3.A` On track — *split further per decision*:
  - `K3.A.i`  นัดติดตั้ง [นัดติดตั้ง] — install date booked, no blocker
  - `K3.A.ii` นัดติดตั้ง [รอเครื่องชาร์จ] — install date booked, waiting on hardware
- `K3.B` Issue flagged — descend to K3.B.* below

**K4 ส่งเสร็จแล้ว · further split:**
- `K4.A` Clean delivery — `workingDays(confirm_setup_date → delivery_date) ≥ 1`
- `K4.B` Suspicious confirm — `workingDays(confirm → delivery) < 1` (potential false-confirm audit; §Platform §5 = 5 % deduction risk)

### Level 3 — Issue Root Cause (only under K2.B and K3.B)

Per the *Keep separate* decision, wrong-number and no-answer get their own leaves. The 9 issue-detail strings → **8 root-cause leaves** under K2.B (and a parallel 7 under K3.B, which doesn't have a "returned to admin" detail):

| Key | Group label | Maps from status detail(s) |
|---|---|---|
| `*.B.1` | รอลูกค้าทำวงจร 2 เอง / Awaiting customer-side wiring | `_รอลูกค้าดำเนินการติดตั้งวงจร2 เอง` |
| `*.B.2` | สถานที่ไม่พร้อม / Location not ready | `_สถานที่ไม่พร้อม/รอย้ายสถานที่ติดตั้ง` |
| `*.B.3a` | ติดต่อไม่ได้ — เบอร์ไม่ถูกต้อง / Wrong phone number | `_ติดต่อลูกค้าไม่ได้(เบอร์ไม่ถูกต้อง)` |
| `*.B.3b` | ติดต่อไม่ได้ — ลูกค้าไม่รับสาย / No answer | `_ติดต่อลูกค้าไม่ได้(ลูกค้าไม่รับสาย)` |
| `*.B.4` | ระบบไฟฟ้าไม่พร้อม / Electrical not ready (return) | `_ระบบไฟฟ้าบ้านลูกค้าไม่พร้อม/คืนงาน` |
| `*.B.5` | ลูกค้าไม่เข้าใจแพ็คเกจ / Customer confusion | `_ลูกค้าไม่เข้าใจแพ็คเกจ ของบริษัท` |
| `*.B.6` | ส่วนกลางจ่ายงานซ้ำ / Duplicate dispatch | `_ส่วนกลางจ่ายงานซ้ำ` and `_ส่วนกลางจ่ายงานซ้ำ/มีทีมอื่นเข้าติดตั้งแล้ว` |
| `K2.B.7` | ลูกค้าไม่ประสงค์ติดตั้ง / Customer declined (K2 only) | `[ลูกค้าไม่ประสงค์ติดตั้ง]` |
| `K2.B.8` | คืนงาน admin (>2 เดือน) / Returned to admin (K2 only) | `[คืนงานสำหรับแอดมิน] ลูกค้าไม่พร้อมติดตั้งเกิน 2 เดือน` |

---

## Full tree (locked structure)

```
ALL CASES (N)
│
├── K1 รับงาน · Intake
│   ├── K1.A Unassigned
│   └── K1.B Assigned · awaiting contact
│
├── K2 ระหว่างติดต่อ · Contacting
│   ├── K2.A Active engagement
│   │   ├── K2.A.i  นัดสำรวจ
│   │   └── K2.A.ii ติดต่อลูกค้าแล้ว
│   └── K2.B Issue flagged
│       ├── K2.B.1  รอลูกค้าทำวงจร 2 เอง
│       ├── K2.B.2  สถานที่ไม่พร้อม
│       ├── K2.B.3a ติดต่อไม่ได้ — เบอร์ไม่ถูกต้อง
│       ├── K2.B.3b ติดต่อไม่ได้ — ลูกค้าไม่รับสาย
│       ├── K2.B.4  ระบบไฟฟ้าไม่พร้อม
│       ├── K2.B.5  ลูกค้าไม่เข้าใจแพ็คเกจ
│       ├── K2.B.6  ส่วนกลางจ่ายงานซ้ำ
│       ├── K2.B.7  ลูกค้าไม่ประสงค์ติดตั้ง
│       └── K2.B.8  คืนงาน admin (>2 เดือน)
│
├── K3 ระหว่างติดตั้ง · Scheduled
│   ├── K3.A On track
│   │   ├── K3.A.i  นัดติดตั้ง
│   │   └── K3.A.ii รอเครื่องชาร์จ
│   └── K3.B Issue flagged
│       ├── K3.B.1  รอลูกค้าทำวงจร 2 เอง
│       ├── K3.B.2  สถานที่ไม่พร้อม
│       ├── K3.B.3a ติดต่อไม่ได้ — เบอร์ไม่ถูกต้อง
│       ├── K3.B.3b ติดต่อไม่ได้ — ลูกค้าไม่รับสาย
│       ├── K3.B.4  ระบบไฟฟ้าไม่พร้อม
│       ├── K3.B.5  ลูกค้าไม่เข้าใจแพ็คเกจ
│       └── K3.B.6  ส่วนกลางจ่ายงานซ้ำ / มีทีมอื่นติดแล้ว
│
└── K4 ส่งเสร็จแล้ว · Delivered
    ├── K4.A Clean delivery
    └── K4.B Suspicious confirm (audit risk)
```

**Leaf count: 27** (8 in K2.B + 7 in K3.B + 2 in K2.A + 2 in K3.A + 2 in K1 + 2 in K4 + 4 stage roots = 27 visualisable cells).

**Auto-return overlay:** any node with `count(cases where now − createdAt > 50d) > 0` gets a red `⚠ auto-return: N` badge on the rendered cell. Doesn't affect tree position.

---

## Dimension 2 — SLA Status (3-way slice)

Every case is also tagged with one of three SLA states. The state is computed *relative to the SLA rule that applies to the case's stage*.

### SLA rule per stage

| Stage | Deadline anchor | Deadline rule (Contract §Installation Service Response Time) |
|---|---|---|
| Intake (K1) | `createdAt` | `+ 24 h` (§1, Contact) |
| Contacting (K2) | `createdAt` | `+ 3 working days` (§2, Survey) |
| Scheduled (K3) | `confirm_setup_date` or fallback `assign_date` | `+ 3 working days` (§3, Install) |
| Delivered (K4) | retrospective: was each prior deadline met? | composite |

There is also a **separate 60-day auto-return clock** (status taxonomy id=11) that overrides everything once a case crosses 60 days from `createdAt`.

### SLA classification logic — active cases (K1, K2, K3)

For each case, compute `lateness = now − deadline`:

| Range | Bucket | Severity |
|---|---|---|
| `lateness ≤ 0` (deadline in future or just hit) | **In SLA** | ok |
| `0 < lateness ≤ 24 h` | **Medium breach** | medium |
| `lateness > 24 h` | **Critical breach** | critical |

### SLA classification logic — Delivered (K4): retrospective worst-case

For each completed case, evaluate all three historical milestones using the case's stored timestamps:

1. **Contact**: `assign_date − createdAt` vs 24h
2. **Survey**: `confirm_setup_date − createdAt` vs 3 working-days
3. **Install**: `delivery_date − confirm_setup_date` vs 3 working-days

Each milestone produces an `In SLA / Medium / Critical` tag using the same `<0 / 0–24h / >24h` thresholds against its rule. The **worst** of the three becomes the case's K4 SLA tag.

Missing timestamps (e.g. no `assign_date` recorded on a legacy case) → that milestone is skipped. If all three are missing, the case shows as `In SLA` by default (no evidence of breach).

This means a delivered case can show as "Critical breach" even though it's done — useful for monthly QA / SLA-compliance reporting under Contract §Service Quality Penalties.

### Example

A case in K2 (Contacting), `createdAt = 7 May 2026`. Today is 12 May 2026.
- Working-days elapsed: 3 (Mon–Wed)
- Deadline = `createdAt + 3 wd` ≈ end of 11 May
- Now is 12 May → `lateness ≈ 1 day` → **Critical** (>24h)

---

## What each tree node will report

For every node (branch or leaf) the dashboard shows:

```
K2.B · Issue flagged · ระหว่างติดต่อ
─────────────────────────────────────────
Total:           N
In SLA:          ●●●●●●  6   (60%)
Medium breach:   ●●      2   (20%)
Critical breach: ●●      2   (20%)
```

with the percent-bar and counts colour-coded by SLA bucket (green / amber / red).

Drill-down: clicking a leaf opens a job-list panel filtered to those cases.

---

## Status: Design frozen ✓

All categorisation rules above are confirmed. Ready to move to **dashboard implementation planning** (visual layout, file structure, render approach, drill-down UX).
