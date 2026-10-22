<#
.SYNOPSIS
  Start Ollama (if needed) and the local Actor bridge at Windows logon.

.DESCRIPTION
  Deliberately free of machine-specific values: the project root is derived
  from this file's location, and the Actor token plus the extension id are read
  from %LOCALAPPDATA%\WebOSAgent (created on first run). Nothing here belongs
  in version control. See docs/autostart.md.

.PARAMETER DryRun
  Print the resolved configuration and exit without starting any process.
#>
[CmdletBinding()]
param(
  [string]$Project,
  [string]$Token,
  [string]$ExtensionId,
  [string]$OllamaExe,
  [string]$OllamaModels,
  [int]$ActorPort = 4319,
  [int]$OllamaPort = 11434,
  [switch]$DryRun
)

$ErrorActionPreference = 'SilentlyContinue'

$StateDir = Join-Path $env:LOCALAPPDATA 'WebOSAgent'
$TokenFile = Join-Path $StateDir 'token.txt'
$ExtensionIdFile = Join-Path $StateDir 'extension-id.txt'
$OllamaExeFile = Join-Path $StateDir 'ollama-exe.txt'
$OllamaModelsFile = Join-Path $StateDir 'ollama-models.txt'
$LogDir = $StateDir
$Log = Join-Path $LogDir 'autostart.log'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log([string]$Message) {
  Add-Content -Path $Log -Value ('[' + (Get-Date -Format 's') + '] ' + $Message)
}

function Test-Port([int]$Port) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  return [bool]$conn
}

# The token is generated locally on first run and reused afterwards, so a fresh
# clone never inherits someone else's credential. -Token and WEBOS_ACTOR_TOKEN
# win over the saved value.
function Resolve-Token {
  if ($Token) { return $Token }
  if ($env:WEBOS_ACTOR_TOKEN) { return $env:WEBOS_ACTOR_TOKEN }
  if (Test-Path $TokenFile) {
    $saved = (Get-Content -Raw -Path $TokenFile).Trim()
    if ($saved) { return $saved }
  }
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 18
  $rng.GetBytes($bytes)
  $generated = 'WebOSLocal-' + (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
  Set-Content -Path $TokenFile -Value $generated -Encoding ASCII
  Write-Log ('token generated: ' + $TokenFile)
  return $generated
}

# Unpacked extensions get an id derived from their directory, so it is a
# per-machine value too. Set it once in the side panel, or write it to
# extension-id.txt, or export WEBOS_EXTENSION_ID.
function Resolve-ExtensionId {
  if ($ExtensionId) { return $ExtensionId }
  if ($env:WEBOS_EXTENSION_ID) { return $env:WEBOS_EXTENSION_ID }
  if (Test-Path $ExtensionIdFile) {
    $saved = (Get-Content -Raw -Path $ExtensionIdFile).Trim()
    if ($saved) { return $saved }
  }
  return ''
}

if (-not $Project) { $Project = Split-Path -Parent $PSScriptRoot }
$ActorEntry = Join-Path $Project 'dist\actor-cli.js'

if (-not $OllamaExe -and $env:WEBOS_OLLAMA_EXE) { $OllamaExe = $env:WEBOS_OLLAMA_EXE }
if (-not $OllamaExe -and (Test-Path $OllamaExeFile)) { $OllamaExe = (Get-Content -Raw -Path $OllamaExeFile).Trim() }
if (-not $OllamaExe) {
  $found = Get-Command ollama.exe -ErrorAction SilentlyContinue
  if ($found) { $OllamaExe = $found.Source }
}
if (-not $OllamaModels -and $env:WEBOS_OLLAMA_MODELS) { $OllamaModels = $env:WEBOS_OLLAMA_MODELS }
if (-not $OllamaModels -and (Test-Path $OllamaModelsFile)) { $OllamaModels = (Get-Content -Raw -Path $OllamaModelsFile).Trim() }

$ResolvedToken = Resolve-Token
$ResolvedExtensionId = Resolve-ExtensionId

if ($DryRun) {
  Write-Output ('project        : ' + $Project)
  Write-Output ('actor entry    : ' + $ActorEntry + ' (exists: ' + [bool](Test-Path $ActorEntry) + ')')
  Write-Output ('state dir      : ' + $StateDir)
  Write-Output ('token file     : ' + $TokenFile)
  Write-Output ('token           : ' + $ResolvedToken)
  Write-Output ('extension id   : ' + $(if ($ResolvedExtensionId) { $ResolvedExtensionId } else { '(unset)' }))
  Write-Output ('extension file : ' + $ExtensionIdFile)
  Write-Output ('ollama exe     : ' + $(if ($OllamaExe) { $OllamaExe } else { '(not found; skipped)' }))
  Write-Output ('ollama models  : ' + $(if ($OllamaModels) { $OllamaModels } else { '(default)' }))
  Write-Output ('ports          : actor ' + $ActorPort + ', ollama ' + $OllamaPort)
  Write-Output ('log            : ' + $Log)
  Write-Output ('actor listening: ' + (Test-Port $ActorPort))
  Write-Output ('ollama listening: ' + (Test-Port $OllamaPort))
  exit 0
}

Write-Log 'autostart begin'

if (-not (Test-Path $Project)) {
  Write-Log ('project missing: ' + $Project)
  exit 1
}

# Build only if the CLI bundle is absent. After source changes, run npm run build.
if (-not (Test-Path $ActorEntry)) {
  Write-Log 'dist/actor-cli.js missing; building'
  Push-Location $Project
  & npm.cmd run build *>> $Log
  Pop-Location
}

if (-not $OllamaExe) {
  Write-Log 'ollama not configured (set WEBOS_OLLAMA_EXE); skipped'
} elseif (-not (Test-Path $OllamaExe)) {
  Write-Log ('ollama missing: ' + $OllamaExe)
} elseif (Test-Port $OllamaPort) {
  Write-Log 'ollama already running'
} else {
  if ($OllamaModels) { $env:OLLAMA_MODELS = $OllamaModels }
  $env:OLLAMA_HOST = '127.0.0.1:' + $OllamaPort
  try {
    Start-Process -FilePath $OllamaExe -ArgumentList 'serve' -WorkingDirectory (Split-Path $OllamaExe) -WindowStyle Hidden
    Write-Log 'ollama start requested'
  } catch {
    Write-Log ('ollama start failed: ' + $_.Exception.Message)
  }
  for ($i = 0; $i -lt 50; $i++) {
    if (Test-Port $OllamaPort) { break }
    Start-Sleep -Milliseconds 200
  }
}

if (Test-Port $ActorPort) {
  Write-Log 'actor already running'
} elseif (-not $ResolvedExtensionId) {
  Write-Log ('actor skipped: extension id unset; write ' + $ExtensionIdFile + ' or set WEBOS_EXTENSION_ID')
} else {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
  $actorArgs = @(
    $ActorEntry,
    '--port', [string]$ActorPort,
    '--token', $ResolvedToken,
    '--allow-origin', ('chrome-extension://' + $ResolvedExtensionId)
  )
  try {
    Start-Process -FilePath $node -ArgumentList $actorArgs -WorkingDirectory $Project -WindowStyle Hidden
    Write-Log 'actor start requested'
    Write-Log ('token source: ' + $TokenFile)
  } catch {
    Write-Log ('actor start failed: ' + $_.Exception.Message)
  }
}

Write-Log 'autostart done'
