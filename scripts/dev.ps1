<#
  Starts the AI/media service, backend API and frontend in separate windows.
  Skips any service whose port is already in use (so you never get a duplicate or EADDRINUSE).

  Usage (from the project root):
    powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 -Python D:\verity-ai\venv\Scripts\python.exe
  or set $env:VERITY_PYTHON once.
#>
param(
  [string]$Python = $(if ($env:VERITY_PYTHON) { $env:VERITY_PYTHON } else { 'D:\verity-ai\venv\Scripts\python.exe' })
)
$root = Split-Path -Parent $PSScriptRoot

function Test-PortBusy([int]$Port) {
  [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
function Start-DevService([string]$Name, [int]$Port, [string]$Dir, [string]$Command) {
  if (Test-PortBusy $Port) { Write-Host "[skip] ${Name}: port $Port is already in use (assuming it is already running)"; return }
  Write-Host "[start] $Name on port $Port"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle='$Name'; Set-Location '$Dir'; $Command"
}

if (-not (Test-Path $Python)) { Write-Error "Python interpreter not found: $Python. Create a Python 3.12 venv and pass -Python <path> (see README)."; exit 1 }
# Keep temp media and the speech model next to the Python environment (often on a drive with more free space than C:).
$venvRoot = Split-Path (Split-Path (Split-Path $Python -Parent) -Parent) -Parent
$tmp = if ($env:MEDIA_TMP_DIR) { $env:MEDIA_TMP_DIR } else { Join-Path $venvRoot 'media-tmp' }
$whisper = if ($env:WHISPER_CACHE_DIR) { $env:WHISPER_CACHE_DIR } else { Join-Path $venvRoot 'whisper-cache' }
New-Item -ItemType Directory -Force $tmp, $whisper | Out-Null

Start-DevService 'AI media service (8000)' 8000 (Join-Path $root 'ai-engine') "`$env:MEDIA_TMP_DIR='$tmp'; `$env:WHISPER_CACHE_DIR='$whisper'; `$env:TMP='$tmp'; `$env:TEMP='$tmp'; & '$Python' -m uvicorn predict:app --host 127.0.0.1 --port 8000"
Start-DevService 'Backend API (5000)' 5000 (Join-Path $root 'backend') 'npm run dev'
Start-DevService 'Frontend (5173)' 5173 (Join-Path $root 'frontend') 'npm run dev'

Write-Host "`nOpen http://localhost:5173  |  API health: http://127.0.0.1:5000/health  |  Media service: http://127.0.0.1:5000/api/model/health"
