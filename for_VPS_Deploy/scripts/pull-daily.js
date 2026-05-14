#!/usr/bin/env node
// =============================================================================
//  INNOPOWER x GWM -- Daily Portal Snapshot (Node.js)
//  Replaces pull-daily.ps1 for Linux/VPS deployment.
//  Requires Node.js 18+ (built-in fetch). No npm install needed.
//
//  Usage:
//    node scripts/pull-daily.js
//
//  Setup (first time):
//    cp scripts/credentials.example.json scripts/credentials.json
//    nano scripts/credentials.json   # fill in real values
//
//  Cron (daily 23:55 Bangkok time):
//    55 23 * * * /usr/bin/node /var/www/gwm/scripts/pull-daily.js >> /var/log/gwm-pull.log 2>&1
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const SCRIPT_DIR   = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const DATA_DIR     = path.join(PROJECT_ROOT, 'data');
const SNAP_DIR     = path.join(DATA_DIR, 'snapshots');
const CSV_PATH     = path.join(DATA_DIR, 'index.csv');
const CRED_PATH    = path.join(SCRIPT_DIR, 'credentials.json');

const CSV_HEADER = 'date,timestamp_iso,total,new,pending,scheduled,completed,statuses,pulled_by,duration_ms';

async function main() {
  const startMs = Date.now();
  const now     = new Date();
  const dateTag = toISODate(now);

  log(`Snapshot pull starting -- ${now.toISOString()}`);

  // --- Load credentials ---
  if (!fs.existsSync(CRED_PATH)) {
    die(`credentials.json not found at ${CRED_PATH}\n  Copy credentials.example.json -> credentials.json and fill in real values.`);
  }
  const cred = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
  if (!cred.username || !cred.password) die('credentials.json is missing username or password.');
  const baseUrl = (cred.baseUrl || 'https://ev.rpdservice.com').replace(/\/$/, '');

  log(`  base: ${baseUrl}`);
  log(`  user: ${cred.username}`);
  fs.mkdirSync(SNAP_DIR, { recursive: true });

  // --- 1) Login ---
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username: cred.username, password: cred.password }),
  });
  if (!loginRes.ok) die(`Login failed: HTTP ${loginRes.status} ${loginRes.statusText}`);

  const loginData = await loginRes.json();
  if (!loginData.access_token) die('Login response had no access_token -- check credentials.');
  const token = loginData.access_token;
  log(`  OK authenticated (token ...${token.slice(-6)})`);

  const headers = { Authorization: `Bearer ${token}` };

  // --- 2) Pull all 5 endpoints in parallel (read-only GETs) ---
  const getJson = async (urlPath) => {
    const r = await fetch(`${baseUrl}${urlPath}`, { headers });
    if (!r.ok) die(`GET ${urlPath} failed: HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };

  log('  fetching...');
  const [me, statuses, bNew, bPending, bScheduled, bCompleted] = await Promise.all([
    getJson('/api/v1/auth/me'),
    getJson('/api/v1/statuses'),
    getJson('/api/v1/jobs?size=500&page=1&status=' + encodeURIComponent('NewJob,Cancelled')),
    getJson('/api/v1/jobs?size=500&page=1&status=InitialCustomer'),
    getJson('/api/v1/jobs?size=500&page=1&status=InstallationScheduled'),
    getJson('/api/v1/jobs?size=500&page=1&status=InstallationCompleted'),
  ]);

  const counts = {
    new:       Number(bNew.totalItems       ?? 0),
    pending:   Number(bPending.totalItems   ?? 0),
    scheduled: Number(bScheduled.totalItems ?? 0),
    completed: Number(bCompleted.totalItems ?? 0),
  };
  const total = counts.new + counts.pending + counts.scheduled + counts.completed;
  log(`  OK counts: new=${counts.new}  pending=${counts.pending}  scheduled=${counts.scheduled}  completed=${counts.completed}  total=${total}`);

  // --- 3) Build snapshot (same schema as pull-daily.ps1) ---
  const durationMs = Date.now() - startMs;
  const snapshot = {
    schema:    'innopower-gwm-snapshot/v1',
    snapshotAt: now.toISOString(),
    date:       dateTag,
    pulledBy:   cred.username,
    operator:   me?.user?.name ?? cred.username,
    baseUrl,
    durationMs,
    counts,
    total,
    statuses,
    jobs: {
      new:       bNew.rows       ?? [],
      pending:   bPending.rows   ?? [],
      scheduled: bScheduled.rows ?? [],
      completed: bCompleted.rows ?? [],
    },
    paginationMeta: {
      new:       { totalItems: bNew.totalItems,       totalPages: bNew.totalPages       },
      pending:   { totalItems: bPending.totalItems,   totalPages: bPending.totalPages   },
      scheduled: { totalItems: bScheduled.totalItems, totalPages: bScheduled.totalPages },
      completed: { totalItems: bCompleted.totalItems, totalPages: bCompleted.totalPages },
    },
  };

  // --- 4) Write snapshot file ---
  const snapPath = path.join(SNAP_DIR, `${dateTag}.json`);
  if (fs.existsSync(snapPath)) log(`  ! overwriting existing ${dateTag}.json (same-day re-run)`);
  fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2), 'utf8');
  const sizeBytes = fs.statSync(snapPath).size;
  log(`  OK wrote ${snapPath} (${sizeBytes.toLocaleString()} bytes, ${durationMs} ms)`);

  // --- 5) Update data/index.csv ---
  const statusCount = Array.isArray(statuses?.value) ? statuses.value.length
                    : Array.isArray(statuses)         ? statuses.length
                    : 0;
  const newRow = [dateTag, now.toISOString(), total, counts.new, counts.pending,
                  counts.scheduled, counts.completed, statusCount, cred.username, durationMs].join(',');

  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, CSV_HEADER + '\n' + newRow + '\n', 'utf8');
    log(`  OK created ${CSV_PATH}`);
  } else {
    const existing = fs.readFileSync(CSV_PATH, 'utf8').split('\n').filter(Boolean);
    const header   = existing[0]?.startsWith('date') ? existing[0] : CSV_HEADER;
    const filtered = existing.filter(l => !l.startsWith('date') && !l.startsWith(dateTag));
    fs.writeFileSync(CSV_PATH, [header, ...filtered, newRow].join('\n') + '\n', 'utf8');
    log(`  OK updated ${CSV_PATH} (${filtered.length + 1} data rows)`);
  }

  log(`Snapshot pull complete -- ${new Date().toISOString()}`);
}

function toISODate(d) {
  // 'sv-SE' locale gives YYYY-MM-DD in local time
  return d.toLocaleDateString('sv-SE');
}

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

function die(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

main().catch(err => {
  process.stderr.write(`FATAL: ${err.stack || err}\n`);
  process.exit(1);
});
