$ErrorActionPreference = 'Stop'

$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$portableApp = Join-Path $projectDirectory 'Vector.exe'
if (Test-Path -LiteralPath $portableApp) {
  Start-Process -FilePath $portableApp -WorkingDirectory $projectDirectory -WindowStyle Hidden
  exit 0
}
$vectorUrl = 'http://localhost:3000/'

try {
  $null = Invoke-WebRequest -Uri $vectorUrl -UseBasicParsing -TimeoutSec 1
  Start-Process $vectorUrl
  Write-Host 'Vector is already running.' -ForegroundColor Green
  exit 0
} catch {
  # Start the local service below.
}

$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$pnpmPath = if ($pnpmCommand) { $pnpmCommand.Source } else {
  Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
}
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'

if (-not (Test-Path -LiteralPath $pnpmPath)) {
  throw 'pnpm was not found. Install Node.js and pnpm, then run this launcher again.'
}

if (Test-Path -LiteralPath $bundledNode) {
  $env:Path = "$bundledNode;$env:Path"
}

Write-Host 'Starting Vector tactical map...' -ForegroundColor Green
$service = Start-Process -FilePath $pnpmPath -ArgumentList 'dev' -WorkingDirectory $projectDirectory -PassThru -WindowStyle Hidden

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($service.HasExited) { throw 'Vector stopped before it was ready.' }
    try {
      $null = Invoke-WebRequest -Uri $vectorUrl -UseBasicParsing -TimeoutSec 1
      $ready = $true
      break
    } catch {
      # Keep waiting for the local page.
    }
  }

  if (-not $ready) { throw 'Vector did not become ready within 20 seconds.' }
  Start-Process $vectorUrl
  Write-Host 'Vector is live at http://localhost:3000' -ForegroundColor Green
  Write-Host 'Keep this window open while you play. Press Ctrl+C to stop.' -ForegroundColor DarkGray
  Wait-Process -Id $service.Id
} finally {
  if (-not $service.HasExited) {
    Stop-Process -Id $service.Id
  }
}
