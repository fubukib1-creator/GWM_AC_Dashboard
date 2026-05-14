/* =============================================================================
 *  INNOPOWER × GWM — v3 · Categorisation Engine
 * =============================================================================
 *
 *  Self-contained, pure-logic module. No DOM, no fetch, no v2 dependencies.
 *
 *  Inputs:  raw job rows from `data/snapshots/YYYYMMDD.json`
 *  Outputs: { tree, leafIndex } for the renderer to draw
 *
 *  Two orthogonal dimensions (see Dashboard/v3/category-keys.md):
 *    1. Dichotomous tree  → classifyJob()
 *    2. SLA status        → computeSLA()
 *
 *  Public API: window.CategoryEngine = { ... } (see bottom)
 * ============================================================================= */

(function (root) {
  'use strict';

  // ─── SLA thresholds (Contract GWMMT2610045) ──────────────────────────────
  const SLA_THRESHOLDS = Object.freeze({
    CONTACT_HOURS: 24,        // §1 Contact
    SURVEY_WD: 3,             // §2 Survey within 3 working days
    INSTALL_WD: 3,            // §3 Install within 3 working days of confirm
    AUTO_RETURN_RISK_DAYS: 50,
    AUTO_RETURN_CUTOFF_DAYS: 60,
    BREACH_MEDIUM_HOURS: 24,  // 0–24h late = medium; >24h = critical
  });

  // Thai public holidays — populate when calendar policy is confirmed
  const THAI_HOLIDAYS = new Set([
    // 'YYYY-MM-DD' entries — treated as non-working days
  ]);

  // ─── Date helpers (self-contained, ~30 LOC) ──────────────────────────────
  function parseDate(s) { return s ? new Date(s) : null; }

  function hoursBetween(a, b) {
    if (!a || !b) return 0;
    return (b.getTime() - a.getTime()) / 3.6e6;
  }

  function daysBetween(a, b) {
    if (!a || !b) return 0;
    return (b.getTime() - a.getTime()) / 8.64e7;
  }

  function workingDaysBetween(from, to) {
    if (!from || !to) return 0;
    const start = new Date(from); start.setHours(0,0,0,0);
    const end   = new Date(to);   end.setHours(0,0,0,0);
    if (end <= start) return 0;
    let count = 0;
    const cur = new Date(start);
    while (cur < end) {
      cur.setDate(cur.getDate() + 1);
      const dow = cur.getDay();
      const iso = cur.toISOString().slice(0,10);
      if (dow !== 0 && dow !== 6 && !THAI_HOLIDAYS.has(iso)) count++;
    }
    return count;
  }

  // Returns a new Date that is `n` working days after `from`, end-of-day.
  function addWorkingDays(from, n) {
    const d = new Date(from);
    let added = 0;
    while (added < n) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      const iso = d.toISOString().slice(0,10);
      if (dow !== 0 && dow !== 6 && !THAI_HOLIDAYS.has(iso)) added++;
    }
    d.setHours(23, 59, 59, 999);
    return d;
  }

  // ─── Status taxonomy → leaf mapping (locked design) ──────────────────────
  // status_customer_id → leaf key. Mirrors the 19-status taxonomy from /api/v1/statuses.
  const STATUS_ID_TO_LEAF = {
    1:  'K2.A.i',    // นัดสำรวจ
    2:  'K2.A.ii',   // ติดต่อลูกค้าแล้ว
    3:  'K2.B.1',    // รอวงจร 2
    4:  'K2.B.2',    // สถานที่ไม่พร้อม
    5:  'K2.B.3a',   // ติดต่อไม่ได้ — เบอร์ไม่ถูกต้อง
    6:  'K2.B.3b',   // ติดต่อไม่ได้ — ลูกค้าไม่รับสาย
    7:  'K2.B.4',    // ระบบไฟฟ้าไม่พร้อม
    8:  'K2.B.5',    // ลูกค้าไม่เข้าใจแพ็คเกจ
    9:  'K2.B.6',    // ส่วนกลางจ่ายงานซ้ำ
    10: 'K2.B.7',    // ลูกค้าไม่ประสงค์ติดตั้ง
    11: 'K2.B.8',    // คืนงานสำหรับแอดมิน (>60d)
    12: 'K3.A.i',    // นัดติดตั้ง
    13: 'K3.A.ii',   // รอเครื่องชาร์จ
    14: 'K3.B.1',    // รอวงจร 2
    15: 'K3.B.2',    // สถานที่ไม่พร้อม
    16: 'K3.B.4',    // ระบบไฟฟ้าไม่พร้อม (.3 skipped intentionally — no contact issues at this stage)
    17: 'K3.B.5',    // ลูกค้าไม่เข้าใจแพ็คเกจ
    18: 'K3.B.6',    // ส่วนกลางจ่ายงานซ้ำ / มีทีมอื่นติดแล้ว
    19: 'K4',        // ติดตั้งเรียบร้อย — split into K4.A / K4.B by timing check
  };

  // ─── Tree definition (LEAF_DEFS) ─────────────────────────────────────────
  // Order matters: this defines the visual order of nodes in the tree.
  const LEAF_DEFS = [
    { key: 'K1',      parent: 'ROOT', depth: 1, isLeaf: false, label_th: 'รับงาน',           label_en: 'Intake' },
    { key: 'K1.A',    parent: 'K1',   depth: 2, isLeaf: true,  label_th: 'ยังไม่จ่ายงาน',     label_en: 'Unassigned' },
    { key: 'K1.B',    parent: 'K1',   depth: 2, isLeaf: true,  label_th: 'จ่ายงานแล้ว · รอติดต่อ', label_en: 'Assigned · awaiting contact' },

    { key: 'K2',      parent: 'ROOT', depth: 1, isLeaf: false, label_th: 'ระหว่างติดต่อ',     label_en: 'Contacting' },
    { key: 'K2.A',    parent: 'K2',   depth: 2, isLeaf: false, label_th: 'กำลังดำเนินการ',    label_en: 'Active engagement' },
    { key: 'K2.A.i',  parent: 'K2.A', depth: 3, isLeaf: true,  label_th: 'นัดสำรวจ',          label_en: 'Survey scheduled' },
    { key: 'K2.A.ii', parent: 'K2.A', depth: 3, isLeaf: true,  label_th: 'ติดต่อลูกค้าแล้ว',  label_en: 'Contacted, awaiting next step' },
    { key: 'K2.B',    parent: 'K2',   depth: 2, isLeaf: false, label_th: 'งานติดปัญหา',       label_en: 'Issue flagged' },
    { key: 'K2.B.1',  parent: 'K2.B', depth: 3, isLeaf: true,  label_th: 'รอลูกค้าทำวงจร 2 เอง', label_en: 'Awaiting customer-side wiring' },
    { key: 'K2.B.2',  parent: 'K2.B', depth: 3, isLeaf: true,  label_th: 'สถานที่ไม่พร้อม',    label_en: 'Location not ready' },
    { key: 'K2.B.3a', parent: 'K2.B', depth: 3, isLeaf: true,  label_th: 'ติดต่อไม่ได้ — เบอร์ไม่ถูกต้อง', label_en: 'Wrong phone number' },
    { key: 'K2.B.3b', parent: 'K2.B', depth: 3, isLeaf: true,  label_th: 'ติดต่อไม่ได้ — ลูกค้าไม่รับสาย', label_en: 'No answer' },
    { key: 'K2.B.4',  parent: 'K2.B', depth: 3, isLeaf: true,  label_th: 'ระบบไฟฟ้าไม่พร้อม', label_en: 'Electrical not ready (return)' },
    { key: 'K2.B.5',  parent: 'K2.B', depth: 3, isLeaf: true,  label_th: 'ลูกค้าไม่เข้าใจแพ็คเกจ', label_en: 'Customer confusion' },
    { key: 'K2.B.6',  parent: 'K2.B', depth: 3, isLeaf: true,  label_th: 'ส่วนกลางจ่ายงานซ้ำ', label_en: 'Duplicate dispatch' },
    { key: 'K2.B.7',  parent: 'K2.B', depth: 3, isLeaf: true,  label_th: 'ลูกค้าไม่ประสงค์ติดตั้ง', label_en: 'Customer declined' },
    { key: 'K2.B.8',  parent: 'K2.B', depth: 3, isLeaf: true,  label_th: 'คืนงาน admin (>2 เดือน)', label_en: 'Returned to admin' },
    // K2.C — catch-all for jobs the classifier can't otherwise place (missing or
    // unknown status_customer_id). In practice almost always K2-bucket cases
    // with incomplete portal data.
    { key: 'K2.C',    parent: 'K2',   depth: 2, isLeaf: true,  label_th: 'ไม่จัดประเภท',       label_en: 'Uncategorised (data missing)' },

    { key: 'K3',      parent: 'ROOT', depth: 1, isLeaf: false, label_th: 'ระหว่างติดตั้ง',    label_en: 'Scheduled' },
    { key: 'K3.A',    parent: 'K3',   depth: 2, isLeaf: false, label_th: 'นัดติดตั้งแล้ว',    label_en: 'On track' },
    { key: 'K3.A.i',  parent: 'K3.A', depth: 3, isLeaf: true,  label_th: 'นัดติดตั้ง',         label_en: 'Install date set' },
    { key: 'K3.A.ii', parent: 'K3.A', depth: 3, isLeaf: true,  label_th: 'รอเครื่องชาร์จ',     label_en: 'Awaiting charger' },
    { key: 'K3.B',    parent: 'K3',   depth: 2, isLeaf: false, label_th: 'งานติดปัญหา',       label_en: 'Issue flagged' },
    { key: 'K3.B.1',  parent: 'K3.B', depth: 3, isLeaf: true,  label_th: 'รอลูกค้าทำวงจร 2 เอง', label_en: 'Awaiting customer-side wiring' },
    { key: 'K3.B.2',  parent: 'K3.B', depth: 3, isLeaf: true,  label_th: 'สถานที่ไม่พร้อม',    label_en: 'Location not ready' },
    { key: 'K3.B.4',  parent: 'K3.B', depth: 3, isLeaf: true,  label_th: 'ระบบไฟฟ้าไม่พร้อม', label_en: 'Electrical not ready' },
    { key: 'K3.B.5',  parent: 'K3.B', depth: 3, isLeaf: true,  label_th: 'ลูกค้าไม่เข้าใจแพ็คเกจ', label_en: 'Customer confusion' },
    { key: 'K3.B.6',  parent: 'K3.B', depth: 3, isLeaf: true,  label_th: 'ส่วนกลางจ่ายงานซ้ำ', label_en: 'Duplicate / other team installed' },

    { key: 'K4',      parent: 'ROOT', depth: 1, isLeaf: false, label_th: 'ส่งเสร็จแล้ว',       label_en: 'Delivered' },
    { key: 'K4.A',    parent: 'K4',   depth: 2, isLeaf: true,  label_th: 'ส่งเรียบร้อย',       label_en: 'Clean delivery' },
    { key: 'K4.B',    parent: 'K4',   depth: 2, isLeaf: true,  label_th: 'ส่งเร็วผิดปกติ (audit)', label_en: 'Suspicious confirm (audit)' },
  ];

  // ─── classifyJob — returns leaf key ──────────────────────────────────────
  function classifyJob(job) {
    const stage = job.parent_status;

    // Stage K1 — Intake: split by assignment presence
    if (stage === 'NewJob') {
      return job.assign_date ? 'K1.B' : 'K1.A';
    }

    // Stage K4 — Delivered: split by suspiciously fast confirm-to-delivery
    if (stage === 'InstallationCompleted') {
      const c = parseDate(job.confirm_setup_date);
      const d = parseDate(job.delivery_date);
      if (c && d && workingDaysBetween(c, d) < 1) return 'K4.B';
      return 'K4.A';
    }

    // Stages K2 + K3 — drive off status_customer_id (the authoritative pointer)
    const sid = job.status_customer_id != null ? job.status_customer_id : (job.Status && job.Status.id);
    if (sid && STATUS_ID_TO_LEAF[sid]) {
      const leaf = STATUS_ID_TO_LEAF[sid];
      // Special: id=19 maps to K4 — but K4 cases come via parent_status check
      // above, so reaching here for sid=19 means an inconsistency. Fall through
      // to K2.C as the catch-all.
      if (leaf === 'K4') return 'K2.C';
      return leaf;
    }

    // No usable status — fall into K2.C (catch-all under K2 "needs attention").
    return 'K2.C';
  }

  // ─── computeSLA — returns SLA tag ────────────────────────────────────────
  //
  // Two lateness measurement rules, depending on the deadline's unit:
  //   - §1 Contact (24 calendar hours)   → lateness measured in CALENDAR ms
  //                                        Medium ≤ 24h, Critical > 24h
  //   - §2 Survey + §3 Install (3 wd)    → lateness measured in WORKING DAYS
  //                                        Medium ≤ 1 working day, Critical > 1
  //
  // Working days = Monday–Friday only (weekdays). No public-holiday calendar
  // is applied (THAI_HOLIDAYS is empty by deliberate choice — conservative
  // counting from Innopower's side until a definitive list is published).
  // See design/contract-and-sla.md "Lateness measurement" and ADR-012.

  function tagCalendar(latenessMs) {
    if (latenessMs <= 0) return 'ok';
    if (latenessMs <= SLA_THRESHOLDS.BREACH_MEDIUM_HOURS * 3.6e6) return 'medium';
    return 'critical';
  }

  function tagWorkingDays(wdLate) {
    if (wdLate <= 0) return 'ok';
    if (wdLate <= 1) return 'medium';
    return 'critical';
  }

  // Working-day lateness: if action (or now) > deadline, count working days
  // between deadline and the action. Mon–Fri only.
  function workingDaysLate(deadline, actionAt) {
    if (!deadline || !actionAt || actionAt <= deadline) return 0;
    return workingDaysBetween(deadline, actionAt);
  }

  function computeSLA(job, now) {
    now = now instanceof Date ? now : (now ? new Date(now) : new Date());
    const stage = job.parent_status;
    const createdAt = parseDate(job.createdAt);

    if (stage === 'NewJob') {
      // §1 Contact — 24 calendar hours
      if (!createdAt) return { tag: 'ok', rule: 'CONTACT_24H', deadline: null, lateness: 0 };
      const deadline = new Date(createdAt.getTime() + SLA_THRESHOLDS.CONTACT_HOURS * 3.6e6);
      const lateness = now.getTime() - deadline.getTime();
      return { tag: tagCalendar(lateness), rule: 'CONTACT_24H', deadline, lateness };
    }

    if (stage === 'InitialCustomer') {
      // §2 Survey — 3 working days from createdAt
      if (!createdAt) return { tag: 'ok', rule: 'SURVEY_3WD', deadline: null, latenessWd: 0 };
      const deadline = addWorkingDays(createdAt, SLA_THRESHOLDS.SURVEY_WD);
      // If customer confirmed (has confirm_setup_date), survey is done → in SLA
      if (job.confirm_setup_date) return { tag: 'ok', rule: 'SURVEY_3WD', deadline, latenessWd: 0 };
      const wdLate = workingDaysLate(deadline, now);
      return { tag: tagWorkingDays(wdLate), rule: 'SURVEY_3WD', deadline, latenessWd: wdLate };
    }

    if (stage === 'InstallationScheduled') {
      // §3 Install — 3 working days from customer approval (confirm_setup_date)
      const anchor = parseDate(job.confirm_setup_date) || parseDate(job.assign_date) || createdAt;
      if (!anchor) return { tag: 'ok', rule: 'INSTALL_3WD', deadline: null, latenessWd: 0 };
      const deadline = addWorkingDays(anchor, SLA_THRESHOLDS.INSTALL_WD);
      if (job.delivery_date) return { tag: 'ok', rule: 'INSTALL_3WD', deadline, latenessWd: 0 };
      const wdLate = workingDaysLate(deadline, now);
      return { tag: tagWorkingDays(wdLate), rule: 'INSTALL_3WD', deadline, latenessWd: wdLate };
    }

    if (stage === 'InstallationCompleted') {
      // K4 retrospective: check every milestone we have evidence for.
      // Contact uses calendar-hour lateness; Survey + Install use working-day lateness.
      const milestones = [];
      const assignAt = parseDate(job.assign_date);
      const confirmAt = parseDate(job.confirm_setup_date);
      const deliveryAt = parseDate(job.delivery_date);

      // Contact: assignAt should be within 24h of createdAt (calendar)
      if (createdAt && assignAt) {
        const dl = new Date(createdAt.getTime() + SLA_THRESHOLDS.CONTACT_HOURS * 3.6e6);
        const lateness = assignAt.getTime() - dl.getTime();
        milestones.push({ rule: 'CONTACT_24H', tag: tagCalendar(lateness), lateness, deadline: dl });
      }
      // Survey: confirmAt should be within 3 working days of createdAt
      if (createdAt && confirmAt) {
        const dl = addWorkingDays(createdAt, SLA_THRESHOLDS.SURVEY_WD);
        const wdLate = workingDaysLate(dl, confirmAt);
        milestones.push({ rule: 'SURVEY_3WD', tag: tagWorkingDays(wdLate), latenessWd: wdLate, deadline: dl });
      }
      // Install: deliveryAt should be within 3 working days of confirmAt
      if (confirmAt && deliveryAt) {
        const dl = addWorkingDays(confirmAt, SLA_THRESHOLDS.INSTALL_WD);
        const wdLate = workingDaysLate(dl, deliveryAt);
        milestones.push({ rule: 'INSTALL_3WD', tag: tagWorkingDays(wdLate), latenessWd: wdLate, deadline: dl });
      }

      // Worst tag wins
      const order = { ok: 0, medium: 1, critical: 2 };
      const worst = milestones.length
        ? milestones.reduce((a, b) => order[b.tag] > order[a.tag] ? b : a)
        : { tag: 'ok', rule: 'NO_DATA', deadline: null };
      return { ...worst, milestoneBreaches: milestones };
    }

    return { tag: 'ok', rule: 'UNKNOWN', deadline: null, lateness: 0 };
  }

  // ─── Auto-return risk overlay ────────────────────────────────────────────
  function isAutoReturnRisk(job, now) {
    if (job.parent_status === 'InstallationCompleted') return false;
    if (job.delivery_date) return false;
    now = now instanceof Date ? now : (now ? new Date(now) : new Date());
    const createdAt = parseDate(job.createdAt);
    if (!createdAt) return false;
    return daysBetween(createdAt, now) > SLA_THRESHOLDS.AUTO_RETURN_RISK_DAYS;
  }

  // ─── buildTree — assemble the recursive count tree ───────────────────────
  function buildTree(jobs, now) {
    now = now instanceof Date ? now : (now ? new Date(now) : new Date());

    const nodes = new Map();
    nodes.set('ROOT', {
      key: 'ROOT', parent: null, depth: 0, isLeaf: false,
      label_th: 'ทุกเคส', label_en: 'All cases',
      count: 0, sla: { ok: 0, medium: 0, critical: 0 }, autoReturn: 0,
      items: [], children: [],
    });

    for (const def of LEAF_DEFS) {
      nodes.set(def.key, {
        key: def.key, parent: def.parent, depth: def.depth, isLeaf: def.isLeaf,
        label_th: def.label_th, label_en: def.label_en,
        count: 0, sla: { ok: 0, medium: 0, critical: 0 }, autoReturn: 0,
        items: [], children: [],
      });
    }

    // Link parents
    for (const node of nodes.values()) {
      if (node.parent && nodes.has(node.parent)) {
        nodes.get(node.parent).children.push(node);
      }
    }

    // Classify each job + tally into its leaf
    for (const job of jobs) {
      const leafKey = classifyJob(job);
      const leaf = nodes.get(leafKey);
      if (!leaf || !leaf.isLeaf) continue;
      const sla = computeSLA(job, now);
      const auto = isAutoReturnRisk(job, now);
      leaf.count++;
      leaf.sla[sla.tag]++;
      if (auto) leaf.autoReturn++;
      leaf.items.push({ job, sla, autoReturn: auto });
    }

    // Propagate aggregates bottom-up
    function propagate(node) {
      if (node.isLeaf) return;
      for (const child of node.children) {
        propagate(child);
        node.count += child.count;
        node.sla.ok += child.sla.ok;
        node.sla.medium += child.sla.medium;
        node.sla.critical += child.sla.critical;
        node.autoReturn += child.autoReturn;
      }
    }
    propagate(nodes.get('ROOT'));

    // Derived metric
    for (const node of nodes.values()) {
      node.slaPct = node.count > 0 ? node.sla.ok / node.count : 1;
    }

    return nodes.get('ROOT');
  }

  // ─── flatten — render-time helper to walk the tree in display order ─────
  function flatten(root, expanded) {
    const rows = [];
    function walk(node) {
      rows.push(node);
      if (!node.isLeaf && expanded.has(node.key)) {
        for (const child of node.children) walk(child);
      }
    }
    if (root.key === 'ROOT') {
      for (const child of root.children) walk(child);
    } else {
      walk(root);
    }
    return rows;
  }

  // ─── Public API ──────────────────────────────────────────────────────────
  root.CategoryEngine = {
    SLA_THRESHOLDS,
    LEAF_DEFS,
    STATUS_ID_TO_LEAF,
    classifyJob,
    computeSLA,
    isAutoReturnRisk,
    buildTree,
    flatten,
    // Date helpers (exposed for app.js)
    parseDate, hoursBetween, daysBetween, workingDaysBetween, addWorkingDays,
  };
})(typeof window !== 'undefined' ? window : globalThis);
