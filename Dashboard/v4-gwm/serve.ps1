# =============================================================================
#  GWM x INNOPOWER -- v4-gwm executive dashboard local HTTP server
# =============================================================================
#
#  Mirrors Dashboard/v3/serve.ps1 but opens the v4-gwm dashboard URL.
#  Serves the project root on http://localhost:8766 so the dashboard can fetch
#  data/index.csv and data/snapshots/*.json without file:// CORS issues.
#
#  Usage:
#    Double-click "Open GWM Executive Dashboard.cmd" at the project root.
#
#  Press Ctrl+C in this window (or close it) to stop the server.
# =============================================================================

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web

$port        = 8766
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)

Write-Host ""
Write-Host "  GWM x INNOPOWER -- Executive Dashboard (v4-gwm)" -ForegroundColor Red
Write-Host "  -----------------------------------------------"
Write-Host "  serving:   $projectRoot"
Write-Host "  port:      $port"
Write-Host "  dashboard: http://localhost:$port/Dashboard/v4-gwm/index.html"
Write-Host ""

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try {
  $listener.Start()
} catch {
  Write-Host ("ERROR: cannot bind to port {0} -- {1}" -f $port, $_.Exception.Message) -ForegroundColor Red
  Write-Host "  (another server might already be running on this port)"
  Write-Host ""
  Write-Host "  Press any key to close..."
  $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  exit 1
}

Write-Host "  status:    running -- close this window to stop" -ForegroundColor Green
Write-Host ""

Start-Process "http://localhost:$port/Dashboard/v4-gwm/index.html"

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.csv'  = 'text/csv; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response

    try {
      $relPath = [System.Web.HttpUtility]::UrlDecode($req.Url.LocalPath).TrimStart('/').Replace('/', '\')
      if ([string]::IsNullOrEmpty($relPath)) { $relPath = 'Dashboard\v4-gwm\index.html' }
      $fullPath = Join-Path $projectRoot $relPath

      $resolved = [System.IO.Path]::GetFullPath($fullPath)
      if (-not $resolved.StartsWith($projectRoot)) {
        $res.StatusCode = 403
        $msg = [System.Text.Encoding]::UTF8.GetBytes('403 forbidden')
        $res.OutputStream.Write($msg, 0, $msg.Length)
        $res.Close()
        continue
      }

      if (Test-Path $fullPath -PathType Container) {
        $fullPath = Join-Path $fullPath 'index.html'
      }

      if (-not (Test-Path $fullPath -PathType Leaf)) {
        $res.StatusCode = 404
        $msg = [System.Text.Encoding]::UTF8.GetBytes("404 not found: $relPath")
        $res.ContentType = 'text/plain; charset=utf-8'
        $res.OutputStream.Write($msg, 0, $msg.Length)
        Write-Host ("  404  " + $relPath) -ForegroundColor Yellow
        $res.Close()
        continue
      }

      $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($fullPath)
      $res.ContentLength64 = $bytes.Length
      $res.Headers.Add('Cache-Control', 'no-cache')
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host ("  200  {0}  {1}  ({2} bytes)" -f $req.HttpMethod, $relPath, $bytes.Length)
    } catch {
      Write-Host ("  ERROR while serving: {0}" -f $_.Exception.Message) -ForegroundColor Red
      try { $res.StatusCode = 500 } catch {}
    } finally {
      try { $res.Close() } catch {}
    }
  }
}
finally {
  $listener.Stop()
  $listener.Close()
  Write-Host ""
  Write-Host "  server stopped." -ForegroundColor Cyan
}
