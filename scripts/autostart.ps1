# Web-OS-Agent autostart: Ollama + local Actor.
# Installed as a hidden logon script; see docs/autostart.md.
$ErrorActionPreference = 'SilentlyContinue'

$Project = 'E:\project\Web-OS-Agent'
$Token = '***REDACTED***'
$ExtensionId = 'lcmjomcdgiaegbkjlhajcbflkehdhcmh'
$OllamaExe = 'E:\tools\ollama\ollama.exe'
$OllamaModels = 'E:\tools\ollama-models'
$LogDir = Join-Path $env:LOCALAPPDATA 'WebOSAgent'
$Log = Join-Path $LogDir 'autostart.log'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
function Write-Log([string]$Message) {
  Add-Content -Path $Log -Value ('[' + (Get-Date -Format 's') + '] ' + $Message)
}
function Test-Port([int]$Port) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  return [bool]$conn
}

Write-Log 'autostart begin'

if (-not (Test-Path $Project)) {
  Write-Log ('project missing: ' + $Project)
  exit 1
}

# Build only if the CLI bundle is absent. After source changes, run npm run build.
if (-not (Test-Path (Join-Path $Project 'dist\actor-cli.js'))) {
  Write-Log 'dist/actor-cli.js missing; building'
  Push-Location $Project
  & npm.cmd run build *>> $Log
  Pop-Location
}

if (-not (Test-Path $OllamaExe)) {
  Write-Log ('ollama missing: ' + $OllamaExe)
} elseif (Test-Port 11434) {
  Write-Log 'ollama already running'
} else {
  $env:OLLAMA_MODELS = $OllamaModels
  $env:OLLAMA_HOST = '127.0.0.1:11434'
  try {
    Start-Process -FilePath $OllamaExe -ArgumentList 'serve' -WorkingDirectory (Split-Path $OllamaExe) -WindowStyle Hidden
    Write-Log 'ollama start requested'
  } catch {
    Write-Log ('ollama start failed: ' + $_.Exception.Message)
  }
  for ($i = 0; $i -lt 50; $i++) {
    if (Test-Port 11434) { break }
    Start-Sleep -Milliseconds 200
  }
}

if (Test-Port 4319) {
  Write-Log 'actor already running'
} else {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
  $actorArgs = @(
    'dist/actor-cli.js',
    '--port', '4319',
    '--token', $Token,
    '--allow-origin', ('chrome-extension://' + $ExtensionId)
  )
  try {
    Start-Process -FilePath $node -ArgumentList $actorArgs -WorkingDirectory $Project -WindowStyle Hidden
    Write-Log 'actor start requested'
  } catch {
    Write-Log ('actor start failed: ' + $_.Exception.Message)
  }
}

Write-Log 'autostart done'
