# Portal API Reference

> Read-only reference for the `ev.rpdservice.com` API used by this project. Strictly the subset we touch — the portal exposes more endpoints, but Innopower must not call any that mutate state.

## Base URL & auth

- **Base:** `https://ev.rpdservice.com`
- **API prefix:** `/api/v1/`
- **Auth scheme:** Bearer token from `POST /api/v1/auth/login`. Token is an opaque hex string (~64 chars), not a JWT; treat as a bearer credential.
- **Token storage in portal:** the portal stores it in browser `localStorage` under key `auth._token.admin` (with the `Bearer ` prefix already attached in some contexts — be aware when reading from there directly vs. constructing it after `/auth/login`).

## Endpoints in use

## Per-stage job-detail URLs

Each stage of the workflow has its **own URL pattern** for the job-detail page on the portal. This is a portal UX convention, not an API contract — but the dashboards link to these URLs for deep navigation.

Keyed by the project's K1-K4 stage vocabulary (see [categorisation-tree.md](categorisation-tree.md)):

| K-key | Stage (`parent_status`) | URL pattern | Verified example |
|---|---|---|---|
| **K1** | `NewJob` (รับงาน) | `/manages/jobs/{id}` | `https://ev.rpdservice.com/manages/jobs/4472` |
| **K2** | `InitialCustomer` (ระหว่างติดต่อ / รอยืนยัน) | `/manages/jobs/pendings/{id}` | `https://ev.rpdservice.com/manages/jobs/pendings/4471` |
| **K3** | `InstallationScheduled` (ระหว่างติดตั้ง) | `/manages/jobs/process/{id}` | `https://ev.rpdservice.com/manages/jobs/process/4088` |
| **K4** | `InstallationCompleted` (ส่งเสร็จแล้ว) | `/manages/jobs/finished/{id}` | `https://ev.rpdservice.com/manages/jobs/finished/4080` |

**The pattern:** each in-flight stage (K2/K3/K4) has its own URL path segment that mirrors the workflow role — `pendings` / `process` / `finished`. K1 is the only stage with **no** path segment because it's the default landing view for a freshly-created case before any EVW action.

Implementation lives in `Dashboard/v3/app.js::portalUrlForJob(j)` — a switch on `parent_status`, with K-key annotations in the case comments.

**Watch-outs:**
- The plural `pendings` is the portal's convention (not `pending`). Easy to typo.
- If a new K-stage is ever introduced (e.g. a K5 audit stage), the URL pattern must be verified manually against the actual portal and added to the helper.

**History of this rule.** Drafted initially based on user-supplied examples for one case each, but two of the four originals turned out to be wrong. Final mapping was confirmed empirically against real portal navigation (cases 4472, 4471, 4088, 4080).

**Lesson:** always verify URL examples against actual portal clicks before treating them as canonical. If in doubt, navigate to the portal, click into a case from that tab, and copy the URL from the address bar — that's ground truth.

### `POST /api/v1/auth/login`

The only write-ish endpoint we use — and it doesn't change any portal data; it just mints a session token.

**Request:**
```http
POST /api/v1/auth/login
Content-Type: application/json

{ "username": "...", "password": "..." }
```

**Response (200):**
```json
{
  "access_token": "ca6ba50f8efb...",
  "refresh_token": "bb18a2...",
  "logo": "1777385612438-fb3bbd537258b363.jpg"
}
```

Use `access_token` as `Authorization: Bearer <token>` on subsequent calls. Token lifetime is unverified; in practice it lasts long enough for a daily pull. Refresh-token flow is not exercised by this project.

### `GET /api/v1/auth/me`

Returns the logged-in operator's profile. Used for sanity-check + provenance on snapshots.

**Response:**
```json
{
  "user": {
    "name": "GWM_HeadOffice",
    "email": "gwm_headoffice@gmai.com",
    "username": "gwm_headoffice",
    "role": "owner",
    "logo": "..."
  }
}
```

### `GET /api/v1/statuses`

Returns the full status taxonomy. Stable — should change rarely. Use as a join lookup for status names/details given a `status_customer_id`.

**Response:** Array of 19 status objects. See "Status taxonomy" below.

### `GET /api/v1/jobs?status=...&size=...&page=...`

The main data endpoint. Returns paginated job rows filtered by parent stage.

**Query params:**
- `status` (required) — one of `NewJob,Cancelled`, `InitialCustomer`, `InstallationScheduled`, `InstallationCompleted`. Comma-separated for OR matching. The first one combines NewJob and Cancelled because that's what the portal's "รับงาน" tab shows.
- `size` — page size. We use `size=500` to fit everything in one page given current volumes (~50 jobs). Increase if Innopower's installation programme grows.
- `page` — 1-indexed.

**Response shape:**
```json
{
  "rows": [
    { "id": 4109, "code": "RO-26031781649", "customer_name": "...", ... },
    ...
  ],
  "totalItems": 15,
  "totalPages": 1
}
```

### Other endpoints we DON'T call

The portal also exposes `/api/v1/templates`, individual job detail endpoints, file-upload endpoints, and write endpoints for updating job state. **None of these are used.** If you need to extend the project to touch new endpoints:
1. Confirm the endpoint is read-only (GET).
2. Add it to `Dashboard/v2/payload.js` and `scripts/pull-daily.ps1` as appropriate.
3. Update this document.

## Job row schema (live, fields we use)

Each row from `/api/v1/jobs` has dozens of fields. We use the following — listed here so the engine code stays grounded.

| Field | Type | Notes |
|---|---|---|
| `id` | int | Internal portal ID; used to construct deep-link URLs `…/manages/jobs/process/<id>`. |
| `code` | string | Human-readable case code like `RO-26031781649`. Mono-spaced display. |
| `customer_name` | string | Thai name, usually. |
| `customer_phone` | string | Often masked. |
| `car_number` | string | Vehicle chassis/VIN-like number, e.g. `PN7G2MPPVT6000925`. |
| `createdAt` | ISO datetime | When the case was opened in the portal. SLA anchor for §1 + §2. |
| `assign_date` | ISO datetime | When EVW assigned a technician team. Closes §1 SLA. |
| `confirm_setup_date` | ISO date | Customer-confirmed install date. Closes §2 SLA, anchors §3 SLA. |
| `delivery_date` | ISO datetime | Install completed. Closes §3 SLA. |
| `setup_date` | ISO date | Internal install scheduling field; usage varies. |
| `car_date` | ISO date | When the car was delivered to the customer. Earlier than the install case usually. |
| `status_customer_id` | int | **Authoritative pointer** to the status taxonomy entry. Use this over the embedded `Status.id` field, which can be missing/null. |
| `diff_day` | int | Portal-computed metric. We compute our own, don't trust this. |
| `Status` | object \| null | Embedded join. Has `id`, `parent_status`, `status` (the name), `detail`. May be partially populated. |
| `AddressJob` | object | Contains `Province` (`{name_th, name_en}`) and `District`. |
| `Mechanic` | object \| null | The assigned technician team — `{id, name}`. Name includes a memorable label like "ช่างโต้ง แพร่". |
| `Employee` | object | The GWM dealership rep — `{name, phone}`. |
| `User` | object | The portal user who created the record. |

## The 19-status taxonomy

Returned by `GET /api/v1/statuses`. Each status has `id`, `parent_status`, `status` (name), `detail`. The taxonomy is partitioned across three parent stages.

### parent_status = InitialCustomer (ids 1–11) — "ระหว่างติดต่อ" tab

| ID | Status name | Detail | Categorisation leaf (v3) |
|---|---|---|---|
| 1 | นัดสำรวจ | `[นัดสำรวจ]` | K2.A.i |
| 2 | ติดต่อลูกค้าแล้ว | `รอติดต่อกลับจากลูกค้าอีกครั้ง/ยังไม่สะดวกคุยรายละเอียด` | K2.A.ii |
| 3 | งานติดปัญหา | `[งานติดปัญหา]_รอลูกค้าดำเนินการติดตั้งวงจร2 เอง` | K2.B.1 |
| 4 | งานติดปัญหา | `[งานติดปัญหา]_สถานที่ไม่พร้อม/รอย้ายสถานที่ติดตั้ง` | K2.B.2 |
| 5 | งานติดปัญหา | `[งานติดปัญหา]_ติดต่อลูกค้าไม่ได้(เบอร์ไม่ถูกต้อง)` | K2.B.3a |
| 6 | งานติดปัญหา | `[งานติดปัญหา]_ติดต่อลูกค้าไม่ได้(ลูกค้าไม่รับสาย)` | K2.B.3b |
| 7 | งานติดปัญหา | `[งานติดปัญหา]_ระบบไฟฟ้าบ้านลูกค้าไม่พร้อม/คืนงาน` | K2.B.4 |
| 8 | งานติดปัญหา | `[งานติดปัญหา]_ลูกค้าไม่เข้าใจแพ็คเกจ ของบริษัท` | K2.B.5 |
| 9 | งานติดปัญหา | `[งานติดปัญหา]_ส่วนกลางจ่ายงานซ้ำ` | K2.B.6 |
| 10 | งานติดปัญหา | `[ลูกค้าไม่ประสงค์ติดตั้ง]` | K2.B.7 |
| 11 | งานติดปัญหา | `[คืนงานสำหรับแอดมิน] ลูกค้าไม่พร้อมติดตั้งเกิน 2 เดือน` | K2.B.8 |

### parent_status = InstallationScheduled (ids 12–18) — "ระหว่างติดตั้ง" tab

| ID | Status name | Detail | Categorisation leaf (v3) |
|---|---|---|---|
| 12 | นัดติดตั้ง | `[นัดติดตั้ง]` | K3.A.i |
| 13 | นัดติดตั้ง | `[รอเครื่องชาร์จ]` | K3.A.ii |
| 14 | งานติดปัญหา | `[งานติดปัญหา]_รอลูกค้าดำเนินการติดตั้งวงจร2 เอง` | K3.B.1 |
| 15 | งานติดปัญหา | `[งานติดปัญหา]_สถานที่ไม่พร้อม/รอย้ายสถานที่ติดตั้ง` | K3.B.2 |
| 16 | งานติดปัญหา | `[งานติดปัญหา]_ระบบไฟฟ้าบ้านลูกค้าไม่พร้อม/คืนงาน` | K3.B.4 |
| 17 | งานติดปัญหา | `[งานติดปัญหา]_ลูกค้าไม่เข้าใจแพ็คเกจ ของบริษัท` | K3.B.5 |
| 18 | งานติดปัญหา | `[งานติดปัญหา]_ส่วนกลางจ่ายงานซ้ำ/มีทีมอื่นเข้าติดตั้งแล้ว` | K3.B.6 |

Note: K3.B has no `.3a` / `.3b` ("cannot contact" sub-codes) because by the time a case is `InstallationScheduled`, contact has been established. The numbering gap (`.3` skipped, jumps `.2 → .4`) is intentional — it makes K2.B.4 and K3.B.4 align semantically as "electrical not ready".

### parent_status = InstallationCompleted (id 19) — "ส่งเสร็จแล้ว" tab

| ID | Status name | Detail | Categorisation leaf (v3) |
|---|---|---|---|
| 19 | ติดตั้งเรียบร้อยแล้ว | `[ติดตั้งเรียบร้อยแล้ว]` | K4.A (or K4.B if suspicious — see categorisation-tree.md) |

### What about `NewJob` and `Cancelled`?

These are `parent_status` values but **don't appear in the 19-status taxonomy**. Jobs in the `NewJob,Cancelled` bucket have `status_customer_id = null` and `Status = null` — they haven't been touched by EVW yet. v3 handles them via the catch-all K1 leaves (`K1.A` Unassigned, `K1.B` Assigned-awaiting-contact). The v2 heat-strip exposes them as cell #20 "Intake (no status yet)".

## Known data quality issues

These are quirks of the live portal data that the engines have to defend against. Documented so future-you doesn't waste time hunting them down.

### Q1 — Embedded `Status.id` is often missing

The `Status` object in a job row may have its `status` (name) and `detail` fields populated but `id` empty/null. The authoritative ID lives in the top-level `status_customer_id` field instead.

**Mitigation:**
- v2: `sla-engine.js` has a `hydrateJobsFromTaxonomy()` step that backfills missing `Status.id` from the taxonomy lookup keyed by `status_customer_id`.
- v3: `category-engine.js` `classifyJob()` reads `status_customer_id` directly, ignoring `Status.id`.

### Q2 — `Status.parent_status` doesn't always match the API filter

A job returned by `?status=InstallationScheduled` can have `Status.parent_status === 'InitialCustomer'` due to inconsistent join projection on the portal side.

**Mitigation:** Always derive the case's parent stage from **the API bucket it was returned in**, not the embedded `Status.parent_status`. Both v2 and v3 tag jobs with `parent_status = BUCKET_STAGE[i]` at fetch time, before any classification.

### Q3 — `assign_date` is null on Intake even when assigned

Cases that have already been picked up by a technician team can still have `assign_date = null` if the portal hasn't propagated the field yet. Treat its absence as "probably not assigned yet" but don't rely on its presence as proof of contact.

### Q4 — Phone numbers and email may be masked / fake

Some `customer_phone` fields appear masked (`08x xxx xxxx`) and some `email` entries are placeholder. Don't rely on these for contact-validity logic.

### Q5 — `confirm_setup_date` precision is date-only

The field is stored as `YYYY-MM-DD` — no time component. SLA math treats it as start-of-day for the anchor, end-of-day-3-wd-later for the deadline.

## Rate limits & call patterns

The portal doesn't publish a rate limit. Observed in practice:
- Login → 5 GETs in ~1 second works fine.
- No throttling encountered at the pull-daily cadence.
- If volume grows, switch the 4 `/jobs` calls to `Promise.all` parallel (the pull script does this sequentially today; v2 does it parallel).

Be conservative — don't poll at high frequency. The daily pipeline is intentional. v2 only fetches on user-Refresh click (manual, not auto).
