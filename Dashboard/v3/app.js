/* =============================================================================
 *  INNOPOWER × GWM — v3 · Dashboard App (renderer + interaction)
 * =============================================================================
 *  Self-contained — reads only from `data/snapshots/*.json` and `data/index.csv`.
 *  Depends on window.CategoryEngine (loaded by ./category-engine.js).
 * ============================================================================= */

(function () {
  'use strict';

  const E = window.CategoryEngine;
  if (!E) {
    console.error('[INNOPOWER v3] category-engine.js must load first.');
    return;
  }

  // ─── State ─────────────────────────────────────────────────────────────
  const state = {
    dates: [],            // [{date, total, ...}, ...] sorted desc
    selectedDate: null,
    snapshot: null,       // raw snapshot JSON
    jobs: [],             // flattened jobs across buckets, tagged with parent_status
    tree: null,           // root node from engine.buildTree
    now: new Date(),      // pin "now" to the snapshot moment for consistent SLA
    expanded: new Set(),  // node keys currently expanded
    selectedLeaf: null,   // leaf key open in drill-down
    drillSort: { col: 'age', dir: 'desc' },
  };

  // Default: expand top-level branches
  for (const def of E.LEAF_DEFS) {
    if (def.depth === 1 && !def.isLeaf) state.expanded.add(def.key);
  }
  state.expanded.add('ROOT');

  // ─── DOM refs ──────────────────────────────────────────────────────────
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
    console.error('[INNOPOWER v3] boot failed', err);
    showBootError(err);
  });

  async function boot() {
    setBootLabel('Loading snapshot index…');
    try {
      state.dates = await loadDateIndex('../../data/index.csv');
    } catch (e) {
      throw new Error(`ไม่สามารถอ่าน data/index.csv ได้ — ${e.message}\n\n` +
        `Path tried: ${new URL('../../data/index.csv', location.href).href}`);
    }
    if (!state.dates.length) {
      throw new Error('data/index.csv ว่างเปล่า — ยังไม่มี snapshot. รัน scripts/pull-daily.ps1 ก่อน.');
    }

    // Populate date picker
    const sel = $('#date-select');
    sel.innerHTML = '';
    for (const row of state.dates) {
      sel.appendChild(el('option', { value: row.date }, `${row.date} · ${row.total} jobs`));
    }

    // Resolve target date from URL ?date= (ISO format) or default to newest.
    // Legacy compact format 'YYYYMMDD' is also accepted for backward compatibility.
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
    $('#drill-close').addEventListener('click', closeDrillDown);
    document.addEventListener('keydown', onKeyDown);

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

  function onKeyDown(e) {
    if (e.key === 'Escape' && $('#drill-panel').classList.contains('open')) closeDrillDown();
  }

  // ─── Snapshot loading ─────────────────────────────────────────────────
  async function loadAndRender(date) {
    state.selectedDate = date;
    // Reflect in URL without reload
    const url = new URL(location.href);
    url.searchParams.set('date', date);
    history.replaceState(null, '', url);

    setBootLabel(`Loading ${date}…`);
    showBootLoading();

    // Snapshot files and CSV index both use ISO date format (YYYY-MM-DD).
    let snap;
    try {
      snap = await loadSnapshot(`../../data/snapshots/${date}.json`);
    } catch (e) {
      throw new Error(`ไม่สามารถอ่าน snapshot ${date}.json ได้ — ${e.message}`);
    }

    state.snapshot = snap;
    state.now = snap.snapshotAt ? new Date(snap.snapshotAt) : new Date();
    state.jobs = flattenJobs(snap);
    state.tree = E.buildTree(state.jobs, state.now);

    // Close drill-down on date change (the underlying leaf might be empty now)
    closeDrillDown();

    renderAll();
    hideBootLoading();

    // Update context labels (show the actual filename on disk)
    $('#ctx-source').textContent = `data/snapshots/${date}.json`;
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

  // Tiny CSV parser — handles quoted fields with embedded commas.
  // PowerShell Export-Csv writes UTF-8 with BOM; strip if present.
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

  // ─── Rendering ─────────────────────────────────────────────────────────
  function renderAll() {
    renderKPIs();
    renderTree();
    updateTreeMeta();
  }

  function renderKPIs() {
    const t = state.tree;
    if (!t) return;
    const pct = t.count ? Math.round(t.slaPct * 100) : 100;
    const target = $('#kpi-strip');
    target.innerHTML = '';
    const kpis = [
      { label: 'Total cases',     val: t.count,          sub: `${state.selectedDate || '—'} snapshot`,        tone: '' },
      { label: 'In SLA',          val: t.sla.ok,         sub: `${pct}% of total`,                              tone: 'ok' },
      { label: 'Medium breach',   val: t.sla.medium,     sub: 'late ≤ 24h',                                    tone: 'medium' },
      { label: 'Critical breach', val: t.sla.critical,   sub: 'late > 24h',                                    tone: 'critical' },
      { label: 'Auto-return risk', val: t.autoReturn,    sub: 'age > 50d active',                              tone: t.autoReturn > 0 ? 'warn' : '' },
    ];
    for (const k of kpis) {
      target.appendChild(el('div', { class: `kpi ${k.tone}` }, [
        el('div', { class: 'kpi-label' }, k.label),
        el('div', { class: 'kpi-val' }, String(k.val)),
        el('div', { class: 'kpi-sub' }, k.sub),
      ]));
    }
  }

  function renderTree() {
    const body = $('#tree-body');
    body.innerHTML = '';
    const rows = E.flatten(state.tree, state.expanded);
    for (const node of rows) {
      body.appendChild(renderRow(node));
    }
  }

  function updateTreeMeta() {
    const t = state.tree;
    if (!t) return;
    const totalLeaves = E.LEAF_DEFS.filter(d => d.isLeaf).length;
    const nonEmptyLeaves = E.LEAF_DEFS
      .filter(d => d.isLeaf)
      .map(d => findNodeByKey(t, d.key))
      .filter(n => n && n.count > 0).length;
    $('#tree-meta').textContent = `${t.count} jobs · ${nonEmptyLeaves}/${totalLeaves} leaves populated`;
  }

  function findNodeByKey(root, key) {
    if (root.key === key) return root;
    for (const c of (root.children || [])) {
      const r = findNodeByKey(c, key);
      if (r) return r;
    }
    return null;
  }

  function renderRow(node) {
    const isLeaf = node.isLeaf;
    const expanded = state.expanded.has(node.key);
    const isEmpty = node.count === 0;
    const classes = [
      'tree-row',
      isLeaf ? 'is-leaf' : 'is-branch',
      expanded ? 'expanded' : '',
      isEmpty ? 'empty' : '',
      state.selectedLeaf === node.key ? 'selected' : '',
    ].filter(Boolean).join(' ');

    const chev = el('div', { class: 'chevron' }, isLeaf ? '' : '▸');
    const key = el('div', { class: 'tree-key' }, node.key);
    const label = el('div', { class: 'tree-label' }, [
      node.label_th,
      el('span', { class: 'label-en' }, node.label_en || ''),
    ]);
    const count = el('div', { class: 'tree-count' }, String(node.count));

    const barWrap = renderSLABar(node);
    const warn = node.autoReturn > 0
      ? el('div', { class: 'auto-return', title: `${node.autoReturn} case(s) over 50 days old — at risk of auto-return (60d cutoff)` }, String(node.autoReturn))
      : el('div', { class: 'auto-return-empty' }, '—');

    const row = el('div', {
      class: classes,
      'data-depth': String(node.depth),
      'data-key': node.key,
      onclick: () => onRowClick(node),
    }, [chev, key, label, count, barWrap, warn]);

    return row;
  }

  function renderSLABar(node) {
    if (node.count === 0) {
      return el('div', { class: 'sla-bar-wrap' }, [
        el('div', { class: 'sla-bar' }, []),
        el('div', { class: 'sla-bar-legend' }, [el('span', { class: 'muted' }, 'no items')]),
      ]);
    }
    const { ok, medium, critical } = node.sla;
    const total = ok + medium + critical || 1;
    const pctOk = (ok / total * 100).toFixed(1);
    const pctMed = (medium / total * 100).toFixed(1);
    const pctCrit = (critical / total * 100).toFixed(1);
    return el('div', { class: 'sla-bar-wrap' }, [
      el('div', { class: 'sla-bar' }, [
        ok       ? el('div', { class: 'seg seg-ok',       style: `width:${pctOk}%`,   title: `${ok} in SLA` })       : null,
        medium   ? el('div', { class: 'seg seg-medium',   style: `width:${pctMed}%`,  title: `${medium} medium breach (≤24h late)` })   : null,
        critical ? el('div', { class: 'seg seg-critical', style: `width:${pctCrit}%`, title: `${critical} critical breach (>24h late)` }) : null,
      ].filter(Boolean)),
      el('div', { class: 'sla-bar-legend' }, [
        el('span', { class: 'leg-ok' },       `🟢 ${ok}`),
        el('span', { class: 'leg-medium' },   `🟡 ${medium}`),
        el('span', { class: 'leg-critical' }, `🔴 ${critical}`),
      ]),
    ]);
  }

  function onRowClick(node) {
    if (node.isLeaf) {
      // Toggle drill-down
      if (state.selectedLeaf === node.key) {
        closeDrillDown();
      } else {
        openDrillDown(node);
      }
    } else {
      // Toggle expand
      if (state.expanded.has(node.key)) state.expanded.delete(node.key);
      else state.expanded.add(node.key);
      renderTree();
    }
  }

  // ─── Drill-down ────────────────────────────────────────────────────────
  function openDrillDown(node) {
    state.selectedLeaf = node.key;
    $('#drill-key').textContent = node.key;
    $('#drill-label').textContent = node.label_th;
    $('#drill-en').textContent = node.label_en || '';

    const sum = $('#drill-summary');
    sum.innerHTML = '';
    sum.appendChild(el('span', { class: 'pip total' }, `total ${node.count}`));
    sum.appendChild(el('span', { class: 'pip ok' }, `in SLA ${node.sla.ok}`));
    sum.appendChild(el('span', { class: 'pip medium' }, `medium ${node.sla.medium}`));
    sum.appendChild(el('span', { class: 'pip critical' }, `critical ${node.sla.critical}`));
    if (node.autoReturn > 0) {
      sum.appendChild(el('span', { class: 'pip critical' }, `⚠ auto-return ${node.autoReturn}`));
    }

    renderDrillTable(node);
    $('#drill-panel').classList.add('open');
    renderTree(); // re-render to reflect selected row
  }

  function closeDrillDown() {
    state.selectedLeaf = null;
    $('#drill-panel').classList.remove('open');
    renderTree();
  }

  function renderDrillTable(node) {
    const body = $('#drill-body');
    body.innerHTML = '';
    if (!node.items || !node.items.length) {
      body.appendChild(el('div', { class: 'drill-empty' }, 'No cases in this category.'));
      return;
    }

    const items = sortItems(node.items.slice(), state.drillSort);

    const table = el('table', { class: 'drill-table' });
    const thead = el('thead');
    const trHead = el('tr');
    const cols = [
      { key: 'code',     label: 'Code' },
      { key: 'customer', label: 'Customer' },
      { key: 'province', label: 'Province' },
      { key: 'age',      label: 'Age', cls: 'r' },
      { key: 'sla',      label: 'SLA' },
      { key: 'detail',   label: 'Detail' },
    ];
    for (const col of cols) {
      const th = el('th', {
        class: col.cls || '',
        onclick: () => {
          if (state.drillSort.col === col.key) state.drillSort.dir = state.drillSort.dir === 'asc' ? 'desc' : 'asc';
          else { state.drillSort.col = col.key; state.drillSort.dir = 'asc'; }
          renderDrillTable(node);
        }
      }, col.label + (state.drillSort.col === col.key ? (state.drillSort.dir === 'asc' ? ' ▲' : ' ▼') : ''));
      trHead.appendChild(th);
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const it of items) {
      const j = it.job;
      const ageMs = j.createdAt ? (state.now.getTime() - new Date(j.createdAt).getTime()) : 0;
      const ageText = ageMs > 0 ? fmtAge(ageMs) : '—';
      const detail = (j.Status && j.Status.detail) || '—';
      const portalUrl = portalUrlForJob(j);
      tbody.appendChild(el('tr', null, [
        el('td', { class: 'col-code' }, [
          el('a', { href: portalUrl, target: '_blank', rel: 'noopener' }, j.code || String(j.id))
        ]),
        el('td', { class: 'col-customer' }, j.customer_name || '—'),
        el('td', { class: 'col-province' }, (j.AddressJob && j.AddressJob.Province && j.AddressJob.Province.name_th) || '—'),
        el('td', { class: 'col-age' }, ageText),
        el('td', { class: 'col-sla' }, [
          el('span', { class: `sla-pill ${it.sla.tag}`, title: slaTooltip(it.sla) }, slaLabel(it.sla.tag))
        ]),
        el('td', { class: 'col-detail', title: detail }, detail),
      ]));
    }
    table.appendChild(tbody);
    body.appendChild(table);
  }

  function sortItems(items, sort) {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const key = sort.col;
    const getter = (it) => {
      const j = it.job;
      switch (key) {
        case 'code':     return j.code || '';
        case 'customer': return j.customer_name || '';
        case 'province': return (j.AddressJob && j.AddressJob.Province && j.AddressJob.Province.name_th) || '';
        case 'age':      return j.createdAt ? -new Date(j.createdAt).getTime() : 0;
        case 'sla':      return { ok: 0, medium: 1, critical: 2 }[it.sla.tag] || 0;
        case 'detail':   return (j.Status && j.Status.detail) || '';
        default:         return '';
      }
    };
    return items.sort((a, b) => {
      const av = getter(a), bv = getter(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────
  function slaLabel(tag) {
    return tag === 'ok' ? 'In SLA' : tag === 'medium' ? 'Medium' : tag === 'critical' ? 'Critical' : tag;
  }

  // Portal URL pattern by K-key (the project's canonical stage vocabulary —
  // see design/categorisation-tree.md and design/api-reference.md):
  //   K1  NewJob                 -> /manages/jobs/{id}            (no segment; default landing)
  //   K2  InitialCustomer        -> /manages/jobs/pendings/{id}   (note: 'pendings' with -s)
  //   K3  InstallationScheduled  -> /manages/jobs/process/{id}
  //   K4  InstallationCompleted  -> /manages/jobs/finished/{id}
  function portalUrlForJob(j) {
    const base = 'https://ev.rpdservice.com/manages/jobs';
    const id = encodeURIComponent(j.id);
    switch (j.parent_status) {
      case 'NewJob':                return `${base}/${id}`;            // K1
      case 'InitialCustomer':       return `${base}/pendings/${id}`;   // K2
      case 'InstallationScheduled': return `${base}/process/${id}`;    // K3
      case 'InstallationCompleted': return `${base}/finished/${id}`;   // K4
      default:                      return `${base}/${id}`;            // catch-all (e.g. K2.C uncategorised)
    }
  }
  function slaTooltip(sla) {
    let line = `Rule: ${sla.rule || 'unknown'}`;
    if (sla.deadline) line += `\nDeadline: ${fmtDateTime(sla.deadline)}`;
    const lateText = formatLateness(sla);
    if (lateText) line += `\nLate by: ${lateText}`;
    if (sla.milestoneBreaches && sla.milestoneBreaches.length) {
      line += '\n\nMilestone breakdown:';
      for (const m of sla.milestoneBreaches) {
        const mLate = formatLateness(m);
        line += `\n  · ${m.rule}: ${m.tag}` + (mLate ? ` (${mLate} late)` : '');
      }
    }
    return line;
  }

  // Format lateness from either calendar-ms (CONTACT_24H) or working-day (SURVEY/INSTALL).
  function formatLateness(o) {
    if (o.latenessWd != null && o.latenessWd > 0) {
      return o.latenessWd === 1 ? '1 working day' : `${o.latenessWd} working days`;
    }
    if (o.lateness != null && o.lateness > 0) return fmtDur(o.lateness);
    return '';
  }
  function fmtAge(ms) {
    const h = ms / 3.6e6;
    if (h < 48) return `${Math.floor(h)}h`;
    const d = ms / 8.64e7;
    return `${Math.floor(d)}d`;
  }
  function fmtDur(ms) {
    const h = ms / 3.6e6;
    if (h < 48) return `${Math.floor(h)}h`;
    const d = ms / 8.64e7;
    return `${d.toFixed(1)}d`;
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return iso; }
  }
  function fmtDateTime(d) {
    if (!d) return '—';
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toLocaleString('th-TH');
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
