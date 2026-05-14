# v3 Categorisation Tree (Dichotomous Key)

> Frozen spec for v3's 24-leaf dichotomous categorisation. Every case classified by `Dashboard/v3/category-engine.js` lands in exactly one leaf. Implementation must match this document; if you change the tree shape, update both.

## Two orthogonal dimensions

Every case is classified along **two independent axes**:

1. **Tree path** — *what kind of case is this?* (this document)
2. **SLA status** — *is it on time or breached?* — see [contract-and-sla.md](contract-and-sla.md) for the 3-way slice (`ok / medium / critical`)

A leaf displays counts in `{count, sla: {ok, medium, critical}, autoReturn}` shape.

## Design decisions baked in (locked, user-approved)

| Question | Choice |
|---|---|
| Tree shape | **Multi-way throughout** — branching factor varies by node, not forced binary |
| L2 detail | **Split further** — K2.A and K3.A show their sub-statuses |
| Cannot-contact issues | **Keep separate** — wrong# and no-answer as own leaves |
| Auto-return clock | **Overlay badge** — tree unchanged; show `⚠ auto-return: N` on any node containing cases >50d old |
| K4 SLA computation | **Retrospective worst-case** — check Contact (24h), Survey (3wd), Install (3wd of confirm); worst breach wins |
| Snapshot scope | **Most recent single snapshot**, with date-picker dropdown for retrospective viewing |
| Leaf drill-down | **Job list table** — code, customer, age, SLA tag (no time-spine / geo / team splits in v3 initial scope) |

## The tree — 24 leaves, 8 branches, 1 root

```
ALL CASES (root, depth 0)
│
├── K1  รับงาน · Intake  (branch, depth 1)
│   ├── K1.A  ยังไม่จ่ายงาน · Unassigned
│   └── K1.B  จ่ายงานแล้ว · รอติดต่อ · Assigned, awaiting contact
│
├── K2  ระหว่างติดต่อ · Contacting  (branch, depth 1)
│   ├── K2.A  กำลังดำเนินการ · Active engagement  (branch, depth 2)
│   │   ├── K2.A.i   นัดสำรวจ · Survey scheduled
│   │   └── K2.A.ii  ติดต่อลูกค้าแล้ว · Contacted, awaiting next step
│   ├── K2.B  งานติดปัญหา · Issue flagged  (branch, depth 2)
│   │   ├── K2.B.1  รอลูกค้าทำวงจร 2 เอง · Awaiting customer-side wiring
│   │   ├── K2.B.2  สถานที่ไม่พร้อม · Location not ready
│   │   ├── K2.B.3a ติดต่อไม่ได้ — เบอร์ไม่ถูกต้อง · Wrong phone number
│   │   ├── K2.B.3b ติดต่อไม่ได้ — ลูกค้าไม่รับสาย · No answer
│   │   ├── K2.B.4  ระบบไฟฟ้าไม่พร้อม · Electrical not ready (return)
│   │   ├── K2.B.5  ลูกค้าไม่เข้าใจแพ็คเกจ · Customer confusion
│   │   ├── K2.B.6  ส่วนกลางจ่ายงานซ้ำ · Duplicate dispatch
│   │   ├── K2.B.7  ลูกค้าไม่ประสงค์ติดตั้ง · Customer declined
│   │   └── K2.B.8  คืนงาน admin (>2 เดือน) · Returned to admin
│   └── K2.C  ไม่จัดประเภท · Uncategorised (data missing) — catch-all
│
├── K3  ระหว่างติดตั้ง · Scheduled  (branch, depth 1)
│   ├── K3.A  นัดติดตั้งแล้ว · On track  (branch, depth 2)
│   │   ├── K3.A.i   นัดติดตั้ง · Install date set
│   │   └── K3.A.ii  รอเครื่องชาร์จ · Awaiting charger
│   └── K3.B  งานติดปัญหา · Issue flagged  (branch, depth 2)
│       ├── K3.B.1  รอลูกค้าทำวงจร 2 เอง
│       ├── K3.B.2  สถานที่ไม่พร้อม
│       ├── K3.B.4  ระบบไฟฟ้าไม่พร้อม          (.3 intentionally skipped)
│       ├── K3.B.5  ลูกค้าไม่เข้าใจแพ็คเกจ
│       └── K3.B.6  ส่วนกลางจ่ายงานซ้ำ / มีทีมอื่นติดแล้ว
│
└── K4  ส่งเสร็จแล้ว · Delivered  (branch, depth 1)
    ├── K4.A  ส่งเรียบร้อย · Clean delivery
    └── K4.B  ส่งเร็วผิดปกติ (audit) · Suspicious confirm
```

**Leaf totals:** K1.A, K1.B (2) + K2.A.i, K2.A.ii (2) + K2.B.{1,2,3a,3b,4,5,6,7,8} (9) + K2.C (1, catch-all) + K3.A.i, K3.A.ii (2) + K3.B.{1,2,4,5,6} (5) + K4.A, K4.B (2) = **23 leaves**. Plus 8 branches + 1 root = 32 total nodes.

**Why K2.C lives under K2** (not at root). The catch-all was originally a top-level `K?` node. It was moved under K2 because in practice almost every uncategorised case is a K2-bucket job with incomplete `status_customer_id` — operationally a "needs attention in the contacting phase" item. A rare K3-bucket uncategorised job still lands here too (mild mis-attribution that's accepted in exchange for a cleaner tree shape).

Auto-return overlay attaches to any node where at least one constituent case has `daysBetween(createdAt, now) > 50`. Doesn't change tree shape — it's a badge rendered on the node row.

## Classification algorithm

Implemented in `Dashboard/v3/category-engine.js::classifyJob(job) → leafKey`.

```
classifyJob(job):
  stage = job.parent_status                  # set from API bucket source, not embedded Status.parent_status

  if stage == 'NewJob':
    return 'K1.B' if job.assign_date else 'K1.A'

  if stage == 'InstallationCompleted':
    if confirm_setup_date and delivery_date:
      if workingDaysBetween(confirm_setup_date, delivery_date) < 1:
        return 'K4.B'   # suspicious — same-day confirm + deliver
    return 'K4.A'        # clean delivery

  # Stages K2 and K3 driven by status_customer_id (the authoritative pointer,
  # see api-reference.md Q1 + Q2 for why we don't trust the embedded Status object)
  sid = job.status_customer_id ?? job.Status?.id
  if sid in STATUS_ID_TO_LEAF:
    leaf = STATUS_ID_TO_LEAF[sid]
    return 'K2.C' if leaf == 'K4' else leaf   # id=19 outside completed bucket = inconsistency

  return 'K2.C'           # safety net — catch-all under K2
```

`STATUS_ID_TO_LEAF` is the 19-entry table mapping each `status_customer_id` to its leaf — listed in `api-reference.md` and duplicated in code as `STATUS_ID_TO_LEAF` constant.

## Portal URL by K-key

When the dashboard links to a job-detail page on the portal, the URL pattern depends on which K-stage the case is in. Full table with verified examples lives in [api-reference.md "Per-stage job-detail URLs"](api-reference.md#per-stage-job-detail-urls). Quick lookup:

| K-key | Path segment |
|---|---|
| K1 | *(none)* — `/manages/jobs/{id}` |
| K2 | `pendings` — `/manages/jobs/pendings/{id}` |
| K3 | `process` — `/manages/jobs/process/{id}` |
| K4 | `finished` — `/manages/jobs/finished/{id}` |

Implementation: `Dashboard/v3/app.js::portalUrlForJob(j)`.

## Why these specific leaf shapes

### K1 split: by assignment, not by age

Earlier drafts had K1 split by SLA age (`Fresh (≤24h)` vs `Overdue (>24h)`). That was wrong — SLA is an orthogonal dimension, not a tree axis. The tree should describe *case type*, not *case timing*.

So K1 splits on a binary case-type question: has EVW picked it up yet? `assign_date` set → K1.B. Not set → K1.A. Independent of SLA breach status (which is shown via the SLA bar).

### K2 / K3: two children each (Active vs Issue), then sub-leaves

The portal has two materially different sub-flows at these stages:
- The case is moving forward (Active engagement) — status is `นัดสำรวจ`, `ติดต่อลูกค้าแล้ว`, `นัดติดตั้ง`, `รอเครื่องชาร์จ` etc.
- The case is stuck (`งานติดปัญหา` — issue flagged) — Innopower wants to know *why* it's stuck → root-cause leaves.

Splitting them at L2 gives clean operational pivots. Drilling into Active tells you "where are healthy cases stacking?" Drilling into Issue tells you "which root cause is biggest?"

### K2.B has 9 leaves, K3.B has only 5

The taxonomy doesn't have "cannot contact" (`.3a` / `.3b`), "customer declined" (`.7`), or "admin return" (`.8`) under InstallationScheduled — by the time you're scheduled, you've already had contact and customer agreement.

The numbering gap (K3.B has `.1, .2, .4, .5, .6`) is intentional — it preserves alignment so K2.B.4 and K3.B.4 both mean "electrical not ready". Renumbering would obscure that parallel.

### K4 split: clean vs suspicious

`K4.B` exists only because of Contract §Platform §5 — the 5% monthly fee deduction for false confirms. We use `workingDays(confirm → delivery) < 1` as the heuristic. It's not a confession of false confirm; it's an audit flag for manual review.

In practice, K4.B should be empty or near-empty when EVW operates honestly. If it grows, that's a signal Innopower should escalate.

### K2.C — uncategorised catch-all

A safety net for jobs the classifier can't place. Possible causes:
- New `status_customer_id` added to the portal but not yet in `STATUS_ID_TO_LEAF`
- Job with `parent_status` outside the four known stages
- Data corruption / incomplete portal join (e.g. row returned without a Status object and without `status_customer_id`)

If K2.C > 0 in any snapshot, that's a signal to update the dashboard. v3 shows it as a regular leaf under K2 with the catch-all label `ไม่จัดประเภท`.

Note: K2.C lives under K2 (not at root) because nearly all uncategorised cases in practice come from the K2 bucket. K3-bucket jobs that somehow can't be classified will also land here — accepted as a minor mis-attribution in exchange for a cleaner tree shape.

## SLA propagation through the tree

`buildTree(jobs, now)` aggregates bottom-up:

```
for every leaf:
  count = number of jobs classified here
  sla = { ok, medium, critical }  computed by computeSLA(job, now) per job
  autoReturn = count where isAutoReturnRisk(job, now) is true

for every branch (post-order):
  count = sum of children counts
  sla = { ok: sum(children.sla.ok), medium: ..., critical: ... }
  autoReturn = sum of children autoReturn

root inherits everything from K1+K2+K3+K4 (K2.C is under K2 so already included via K2)
```

The KPI tiles at the top of the dashboard show the root's values directly.

## Implementation invariants

When modifying `category-engine.js` or `STATUS_ID_TO_LEAF`, these must remain true:

1. **Exhaustive coverage**: every job goes to exactly one leaf. Sum of leaf counts = total jobs in snapshot. If a job can't be placed elsewhere, it lands in `K2.C`.
2. **No double counting**: a job never appears in two leaves.
3. **Status taxonomy mapping is complete**: every `status_customer_id` in the 19-status taxonomy maps to a non-K4 leaf, except id=19 which maps to K4 (and then K4.A/B by timing).
4. **Branch aggregates are consistent**: each branch's count == sum of its descendant leaves' counts.
5. **K2.C is a leaf, not a branch**: it has no children. Catch-all only.

A unit test could be added later that loads a snapshot, runs `buildTree`, and asserts these invariants. Worth doing if the engine grows more complex.

## Extending the tree

If the portal adds a new status_customer_id:

1. Update `api-reference.md` with the new taxonomy entry.
2. Update this document with the new leaf key + position in the tree.
3. Update `STATUS_ID_TO_LEAF` in `Dashboard/v3/category-engine.js`.
4. Add a new entry to `LEAF_DEFS` in the same file (label_th, label_en, parent, depth, isLeaf).
5. Verify with: load a snapshot containing the new status, check that K2.C count is 0 (or unchanged) and the new leaf is populated.

If a new *category type* is needed (e.g. a new K5 stage):

1. Add a `parent_status` value to the bucket flatten logic in `app.js::flattenJobs`.
2. Update `pull-daily.ps1` to fetch the new bucket if it's a new API filter.
3. Add the K5 branch + leaves to `LEAF_DEFS`.
4. Verify the snapshot schema can carry the new bucket (`snap.jobs.<bucketname>`).
