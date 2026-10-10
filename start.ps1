$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "pdf-qa-demo\backend"
$frontend = Join-Path $root "pdf-qa-demo\frontend"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  DocMind: Starting Backend and Frontend together" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python was not found in PATH. Install Python 3.11+ first."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found in PATH. Install Node.js 18+ first."
}
if (-not (Test-Path (Join-Path $backend "main.py"))) {
  throw "Backend folder was not found: $backend"
}
if (-not (Test-Path (Join-Path $frontend "package.json"))) {
  throw "Frontend folder was not found: $frontend"
}

if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
  Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
  Push-Location $frontend
  npm install
  Pop-Location
}

$backendCommand = "Set-Location -LiteralPath '$backend'; python -m uvicorn main:app --reload --port 8000"
$frontendCommand = "Set-Location -LiteralPath '$frontend'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-Command", $backendCommand
Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-Command", $frontendCommand

Write-Host "`nBackend:  http://localhost:8000" -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "`nDono services alag windows mein start ho gayi hain." -ForegroundColor Yellow
