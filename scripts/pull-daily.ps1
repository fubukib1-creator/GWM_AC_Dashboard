# =============================================================================
#  INNOPOWER x GWM -- Daily Portal Snapshot
# =============================================================================
#
#  Logs into ev.rpdservice.com with stored credentials, pulls the 5 read-only
#  data endpoints, and writes a single dated JSON snapshot to
#  <projectroot>/data/snapshots/YYYY-MM-DD.json. Also updates data/index.csv
#  with one summary row per day.
#
#  Read-only -- same constraint as the dashboard. Only GETs to the portal API
#  (plus the single POST /api/v1/auth/login to mint a session token).
#
#  Usage:
#    From a PowerShell prompt:
#      cd "scripts"
#      ./pull-daily.ps1
#
#    Or via the launcher (recommended):
#      double-click "Refresh and Open Dashboard.cmd" at project root
#
#  Setup (first time):
#    1. Copy `credentials.example.json` to `credentials.json` in this folder
#    2. Edit it with your real portal username + password
#    3. Run the script
#
#  Schedule (optional -- Windows Task Scheduler):
#    Action:    Start a program
#    Program:   powershell.exe
#    Arguments: -NoProfile -ExecutionPolicy Bypass -File <full path to this file>
#    Trigger:   Daily at 23:55
#
#  Same-day re-run behaviour:
#    Re-running on the same date OVERWRITES the snapshot JSON for that date
#    AND replaces the row in index.csv with the new pull. No history is kept
#    within a single day; only the most recent run is preserved per date.
# =============================================================================

$ErrorActionPreference = 'Stop'

# Allow Thai characters in console output (paths, customer names, etc.)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$dataDir = Join-Path $projectRoot 'data'
$snapDir = Join-Path $dataDir 'snapshots'
$csvPath = Join-Path $dataDir 'index.csv'
$credPath = Join-Path $scriptDir 'credentials.json'

# Ensure folders exist
New-Item -ItemType Directory -Path $snapDir -Force | Out-Null

# --- Load credentials --------------------------------------------------------
if (-not (Test-Path $credPath)) {
  Write-Host "ERROR: credentials.json not found at $credPath" -ForegroundColor Red
  Write-Host "  -> Copy credentials.example.json to credentials.json and fill in real values."
  exit 1
}
$cred = Get-Content $credPath -Raw -Encoding utf8 | ConvertFrom-Json
if (-not $cred.username -or -not $cred.password) {
  Write-Host "ERROR: credentials.json is missing username or password fields." -ForegroundColor Red
  exit 1
}

$baseUrl = if ($cred.baseUrl) { $cred.baseUrl.TrimEnd('/') } else { 'https://ev.rpdservice.com' }
$logTimestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Write-Host "[$logTimestamp] Snapshot pull starting..." -ForegroundColor Cyan
Write-Host "  base: $baseUrl"
Write-Host "  user: $($cred.username)"
$startTick = Get-Date

# --- 1) Login ---------------------------------------------------------------
try {
  $loginBody = @{ username = $cred.username; password = $cred.password } | ConvertTo-Json -Compress
  $login = Invoke-RestMethod -Uri "$baseUrl/api/v1/auth/login" -Method POST `
            -Body $loginBody -ContentType 'application/json' -TimeoutSec 30
} catch {
  Write-Host ("ERROR: login failed -- {0}" -f $_.Exception.Message) -ForegroundColor Red
  exit 2
}
if (-not $login.access_token) {
  Write-Host "ERROR: login response had no access_token." -ForegroundColor Red
  exit 2
}
$tokenTail = $login.access_token.Substring($login.access_token.Length - 6)
Write-Host ("  OK authenticated (token ...{0})" -f $tokenTail)

$headers = @{ Authorization = "Bearer $($login.access_token)" }

# --- 2) Pull all 5 endpoints -------------------------------------------------
function Get-Json($path) {
  return Invoke-RestMethod -Uri "$baseUrl$path" -Headers $headers -Method GET -TimeoutSec 60
}

Write-Host "  fetching..."
$me        = Get-Json '/api/v1/auth/me'
$statuses  = Get-Json '/api/v1/statuses'

$buckets = [ordered]@{
  new        = Get-Json ('/api/v1/jobs?size=500&page=1&status=' + [uri]::EscapeDataString('NewJob,Cancelled'))
  pending    = Get-Json '/api/v1/jobs?size=500&page=1&status=InitialCustomer'
  scheduled  = Get-Json '/api/v1/jobs?size=500&page=1&status=InstallationScheduled'
  completed  = Get-Json '/api/v1/jobs?size=500&page=1&status=InstallationCompleted'
}

$counts = [ordered]@{
  new       = [int]$buckets.new.totalItems
  pending   = [int]$buckets.pending.totalItems
  scheduled = [int]$buckets.scheduled.totalItems
  completed = [int]$buckets.completed.totalItems
}
$total = $counts.new + $counts.pending + $counts.scheduled + $counts.completed
Write-Host ("  OK counts: new={0}  pending={1}  scheduled={2}  completed={3}  total={4}" -f $counts.new, $counts.pending, $counts.scheduled, $counts.completed, $total)

# --- 3) Build snapshot object ------------------------------------------------
$snapshot = [ordered]@{
  schema       = 'innopower-gwm-snapshot/v1'
  snapshotAt   = (Get-Date).ToString('o')
  date         = (Get-Date -Format 'yyyy-MM-dd')
  pulledBy     = $cred.username
  operator     = $me.user.name
  baseUrl      = $baseUrl
  durationMs   = $null   # filled in below
  counts       = $counts
  total        = $total
  statuses     = $statuses
  jobs         = [ordered]@{
    new       = $buckets.new.rows
    pending   = $buckets.pending.rows
    scheduled = $buckets.scheduled.rows
    completed = $buckets.completed.rows
  }
  paginationMeta = [ordered]@{
    new       = @{ totalItems = $buckets.new.totalItems;       totalPages = $buckets.new.totalPages }
    pending   = @{ totalItems = $buckets.pending.totalItems;   totalPages = $buckets.pending.totalPages }
    scheduled = @{ totalItems = $buckets.scheduled.totalItems; totalPages = $buckets.scheduled.totalPages }
    completed = @{ totalItems = $buckets.completed.totalItems; totalPages = $buckets.completed.totalPages }
  }
}

$endTick = Get-Date
$durMs = [int]($endTick - $startTick).TotalMilliseconds
$snapshot.durationMs = $durMs

# --- 4) Write snapshot file --------------------------------------------------
$dateTag = Get-Date -Format 'yyyy-MM-dd'
$snapPath = Join-Path $snapDir "$dateTag.json"

# Warn if same-day re-run will overwrite the existing file
if (Test-Path $snapPath) {
  Write-Host ("  ! overwriting existing snapshot {0}.json (same-day re-run)" -f $dateTag) -ForegroundColor Yellow
}

$json = $snapshot | ConvertTo-Json -Depth 100 -Compress:$false
[System.IO.File]::WriteAllText($snapPath, $json, [System.Text.UTF8Encoding]::new($false))
$size = (Get-Item $snapPath).Length
Write-Host ("  OK wrote {0} ({1:N0} bytes, {2} ms)" -f $snapPath, $size, $durMs) -ForegroundColor Green

# --- 5) Append/update CSV trend index ----------------------------------------
# Schema: date, timestamp_iso, total, new, pending, scheduled, completed, statuses, pulled_by, duration_ms
$dateIso = $snapshot.date
$row = [pscustomobject]@{
  date          = $dateIso
  timestamp_iso = $snapshot.snapshotAt
  total         = $total
  new           = $counts.new
  pending       = $counts.pending
  scheduled     = $counts.scheduled
  completed     = $counts.completed
  statuses      = $statuses.Count
  pulled_by     = $cred.username
  duration_ms   = $durMs
}

if (-not (Test-Path $csvPath)) {
  # Create with header
  $row | Export-Csv -Path $csvPath -NoTypeInformation -Encoding utf8
  Write-Host "  OK created $csvPath"
} else {
  # If today's row already exists, replace it; else append
  $existing = Import-Csv -Path $csvPath -Encoding utf8
  $filtered = @($existing | Where-Object { $_.date -ne $dateIso })
  $updated  = @($filtered) + $row
  $updated | Export-Csv -Path $csvPath -NoTypeInformation -Encoding utf8
  Write-Host ("  OK updated $csvPath ({0} rows total)" -f $updated.Count)
}

# --- 6) Done -----------------------------------------------------------------
$logTimestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Write-Host "[$logTimestamp] Snapshot pull complete." -ForegroundColor Cyan