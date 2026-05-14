/* =============================================================================
 *  GWM × INNOPOWER — v4-gwm · Executive Dashboard App
 * =============================================================================
 *  Snapshot-based, English-only, no SLA. Five KPI tiles + expandable
 *  Issue Flagged drilldown grouped by root cause.
 *
 *  Depends on window.CategoryEngine (loaded by ./category-engine.js).
 *  Only uses CategoryEngine.classifyJob() — SLA functions are unused.
 * ============================================================================= */

(function () {
  'use strict';

  const E = window.CategoryEngine;
  if (!E) {
    console.error('[v4-gwm] category-engine.js must load first.');
    return;
  }

  // ─── KPI bucket definitions (the executive-view mapping) ────────────────
  // Leaves that count toward "Issue Flagged" — (K2.B \ K2.B.7) + K3.B.
  // Verified against LEAF_DEFS in category-engine.js.
  const ISSUE_LEAVES = new Set([
    'K2.B.1', 'K2.B.2', 'K2.B.3a', 'K2.B.3b', 'K2.B.4', 'K2.B.5', 'K2.B.6', 'K2.B.8',
    'K3.B.1', 'K3.B.2',           'K3.B.4', 'K3.B.5', 'K3.B.6',
  ]);

  // Each leaf → root-cause sub-bucket. K2.B and K3.B share trailing indices
  // by design (the .4 ↔ .4 alignment is intentional — both mean "electrical").
  const ROOT_CAUSE_GROUP = {
    'K2.B.1':  'wiring',
    'K3.B.1':  'wiring',
    'K2.B.2':  'location',
    'K3.B.2':  'location',
    'K2.B.3a': 'contact',
    'K2.B.3b': 'contact',
    'K2.B.4':  'electrical',
    'K3.B.4':  'electrical',
    'K2.B.5':  'confusion',
    'K3.B.5':  'confusion',
    'K2.B.6':  'others',
    'K3.B.6':  'others',
    'K2.B.8':  'others',
  };

  // Display order + metadata for the six sub-buckets
  const SUB_BUCKETS = [
    { key: 'wiring',     label: 'Awaiting customer-side wiring',     codes: 'K2.B.1 · K3.B.1',  source: 'customer' },
    { key: 'location',   label: 'Location not ready',                 codes: 'K2.B.2 · K3.B.2',  source: 'customer' },
    { key: 'contact',    label: 'Cannot contact customer',            codes: 'K2.B.3a · K2.B.3b', source: 'customer' },
    { key: 'electrical', label: 'Electrical system not ready',        codes: 'K2.B.4 · K3.B.4',  source: 'customer' },
    { key: 'confusion',  label: 'Customer confusion (package)',       codes: 'K2.B.5 · K3.B.5',  source: 'customer' },
    { key: 'others',     label: 'Others (duplicate dispatch / admin return)', codes: 'K2.B.6 · K3.B.6 · K2.B.8', source: 'ops' },
  ];

  // ─── State ─────────────────────────────────────────────────────────────
  const state = {
    dates: [],
    selectedDate: null,
    snapshot: null,
    jobs: [],
    buckets: null,
    issueExpanded: false,
  };

  // ─── DOM helpers ───────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs, children) => {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v != null) n.setAttribute(k, v);
    }
    if (children) for (const c of [].concat(children)) {
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };

  // ─── Boot ──────────────────────────────────────────────────────────────
  boot().catch(err => {
    console.error('[v4-gwm] boot failed', err);
    showBootError(err);
  });

  async function boot() {
    setBootLabel('Loading snapshot index…');
    try {
      state.dates = await loadDateIndex('../../data/index.csv');
    } catch (e) {
      throw new Error(`Cannot read data/index.csv — ${e.message}\n\n` +
        `Path tried: ${new URL('../../data/index.csv', location.href).href}`);
    }
    if (!state.dates.length) {
      throw new Error('data/index.csv is empty — no snapshots yet. Run scripts/pull-daily.ps1 first.');
    }

    // Populate the date picker
    const sel = $('#date-select');
    sel.innerHTML = '';
    for (const row of state.dates) {
      sel.appendChild(el('option', { value: row.date }, `${row.date} · ${row.total} jobs`));
    }

    // Resolve target date from URL ?date= or default to newest
    let urlDate = new URLSearchParams(location.search).get('date');
    if (urlDate && /^\d{8}$/.test(urlDate)) {
      urlDate = `${urlDate.slice(0,4)}-${urlDate.slice(4,6)}-${urlDate.slice(6,8)}`;
    }
    const target = (urlDate && state.dates.find(d => d.date === urlDate)) ? urlDate : state.dates[0].date;
    sel.value = target;

    setBootLabel('Loading snapshot…');
    await loadAndRender(target);

    // Wire interactions
    sel.addEventListener('change', () => loadAndRender(sel.value));
    $('#date-prev').addEventListener('click', () => navigateDate(-1));
    $('#date-next').addEventListener('click', () => navigateDate(+1));

    hideBootLoading();
  }

  function navigateDate(delta) {
    const i = state.dates.findIndex(d => d.date === state.selectedDate);
    const next = state.dates[i + delta];
    if (next) {
      $('#date-select').value = next.date;
      loadAndRender(next.date);
    }
  }

  // ─── Snapshot loading ──────────────────────────────────────────────────
  async function loadAndRender(date) {
    state.selectedDate = date;
    const url = new URL(location.href);
    url.searchParams.set('date', date);
    history.replaceState(null, '', url);

    setBootLabel(`Loading ${date}…`);
    showBootLoading();

    let snap;
    try {
      snap = await loadSnapshot(`../../data/snapshots/${date}.json`);
    } catch (e) {
      throw new Error(`Cannot read snapshot ${date}.json — ${e.message}`);
    }

    state.snapshot = snap;
    state.jobs = flattenJobs(snap);
    state.buckets = aggregateBuckets(state.jobs);

    renderAll();
    hideBootLoading();

    $('#footer-source-file').textContent = `data/snapshots/${date}.json`;
    $('#footer-pulled-by').textContent = snap.pulledBy
      ? `pulled by ${snap.pulledBy}${snap.operator ? ' (' + snap.operator + ')' : ''} at ${fmtTime(snap.snapshotAt)}`
      : '—';
  }

  async function loadSnapshot(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    return res.json();
  }

  async function loadDateIndex(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    const text = await res.text();
    return parseCSV(text)
      .filter(r => r.date)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = text.split(/\r?\n/).filter(l => l.length);
    if (!lines.length) return [];
    const headers = parseCSVLine(lines[0]);
    return lines.slice(1).map(line => {
      const cols = parseCSVLine(line);
      const row = {};
      headers.forEach((h, i) => row[h] = cols[i]);
      return row;
    });
  }
  function parseCSVLine(line) {
    const out = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        out.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  function flattenJobs(snap) {
    const buckets = [
      { rows: snap.jobs && snap.jobs.new,       stage: 'NewJob' },
      { rows: snap.jobs && snap.jobs.pending,   stage: 'InitialCustomer' },
      { rows: snap.jobs && snap.jobs.scheduled, stage: 'InstallationScheduled' },
      { rows: snap.jobs && snap.jobs.completed, stage: 'InstallationCompleted' },
    ];
    return buckets.flatMap(b => (b.rows || []).map(r => Object.assign({}, r, { parent_status: b.stage })));
  }

  // ─── Bucket aggregation ────────────────────────────────────────────────
  function aggregateBuckets(jobs) {
    const b = {
      total: 0,
      scheduled: 0,    // K3.A.i + K3.A.ii
      installed: 0,    // K4.A + K4.B
      notInstall: 0,   // K2.B.7
      issueFlagged: 0, // (K2.B \ K2.B.7) + K3.B
      issueBreakdown: {
        wiring: 0, location: 0, contact: 0, electrical: 0,
        confusion: 0, others: 0,
      },
    };
    for (const j of jobs) {
      b.total++;
      const leaf = E.classifyJob(j);
      if (leaf === 'K3.A.i' || leaf === 'K3.A.ii') {
        b.scheduled++;
      } else if (leaf === 'K4.A' || leaf === 'K4.B') {
        b.installed++;
      } else if (leaf === 'K2.B.7') {
        b.notInstall++;
      } else if (ISSUE_LEAVES.has(leaf)) {
        b.issueFlagged++;
        const group = ROOT_CAUSE_GROUP[leaf];
        if (group) b.issueBreakdown[group]++;
      }
      // K1.*, K2.A.*, K2.C — early-stage cases, intentionally not surfaced
    }
    return b;
  }

  // ─── Rendering ─────────────────────────────────────────────────────────
  function renderAll() {
    renderKPIs();
    renderDrilldown();
  }

  function renderKPIs() {
    const b = state.buckets;
    if (!b) return;
    const target = $('#kpi-strip');
    target.innerHTML = '';

    const tiles = [
      { key: 'total',        cls: 'tile-total',     label: 'Total Cases',    val: b.total,        sub: snapshotSubtitle() },
      { key: 'scheduled',    cls: 'tile-scheduled', label: 'Scheduled',      val: b.scheduled,    sub: 'install date set / awaiting charger' },
      { key: 'installed',    cls: 'tile-installed', label: 'Installed',      val: b.installed,    sub: pctText(b.installed, b.total) + ' of total' },
      { key: 'notInstall',   cls: 'tile-not',       label: 'Not Install',    val: b.notInstall,   sub: 'customer declined' },
      { key: 'issueFlagged', cls: 'tile-issue',     label: 'Issue Flagged',  val: b.issueFlagged, sub: 'click to see root causes' },
    ];

    for (const t of tiles) {
      const tile = el('div', { class: `kpi ${t.cls}${t.key === 'issueFlagged' && state.issueExpanded ? ' expanded' : ''}` }, [
        el('div', { class: 'kpi-label' }, t.label),
        el('div', { class: 'kpi-val' }, String(t.val)),
        el('div', { class: 'kpi-sub' }, t.sub),
      ]);
      if (t.key === 'issueFlagged') {
        tile.addEventListener('click', toggleDrilldown);
      }
      target.appendChild(tile);
    }
  }

  function snapshotSubtitle() {
    if (!state.selectedDate) return '—';
    return `snapshot · ${state.selectedDate}`;
  }

  function pctText(part, whole) {
    if (!whole) return '0%';
    return `${Math.round(part / whole * 100)}%`;
  }

  function renderDrilldown() {
    const b = state.buckets;
    if (!b) return;
    const grid = $('#drilldown-grid');
    grid.innerHTML = '';
    for (const sub of SUB_BUCKETS) {
      const count = b.issueBreakdown[sub.key] || 0;
      const tile = el('div', { class: `sub-tile ${count === 0 ? 'empty' : ''}` }, [
        el('div', { class: `sub-tile-badge ${sub.source}`, title: sub.source === 'customer' ? 'Customer-side issue' : 'Operational / admin' }),
        el('div', { class: 'sub-tile-label' }, sub.label),
        el('div', { class: 'sub-tile-val' }, String(count)),
        el('div', { class: 'sub-tile-source' }, sub.codes),
      ]);
      grid.appendChild(tile);
    }

    // Reflect expanded state in DOM (panel visibility is driven by .hidden class)
    const panel = $('#issue-drilldown');
    if (state.issueExpanded) {
      panel.classList.remove('hidden');
      panel.setAttribute('aria-hidden', 'false');
    } else {
      panel.classList.add('hidden');
      panel.setAttribute('aria-hidden', 'true');
    }
  }

  function toggleDrilldown() {
    state.issueExpanded = !state.issueExpanded;
    // Re-render KPIs to flip the chevron class, and drilldown panel for visibility
    renderKPIs();
    renderDrilldown();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────
  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return iso; }
  }

  // ─── Boot UI ───────────────────────────────────────────────────────────
  function setBootLabel(s) {
    const l = document.getElementById('boot-label');
    if (l) l.textContent = s;
  }
  function showBootLoading() { document.getElementById('boot-loading').classList.remove('hide'); }
  function hideBootLoading() { document.getElementById('boot-loading').classList.add('hide'); }
  function showBootError(err) {
    document.getElementById('boot-loading').style.display = 'none';
    const c = document.getElementById('boot-error');
    document.getElementById('boot-error-detail').textContent = (err && err.message) || String(err);
    c.style.display = '';
  }
})();
