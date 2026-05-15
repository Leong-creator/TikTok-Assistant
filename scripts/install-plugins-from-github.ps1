param(
  [string]$RepoUrl = "https://github.com/Leong-creator/TikTok-Assistant",
  [switch]$SkipCoBrowser,
  [switch]$SkipTikTokMonitor,
  [switch]$SkipDependencies,
  [switch]$RunDoctor,
  [switch]$PlanOnly
)

$ErrorActionPreference = "Stop"

$CoBrowserVersion = "0.1.1"
$TikTokMonitorVersion = "0.1.0"

function Resolve-ReleaseUrl {
  param(
    [string]$Tag,
    [string]$FileName
  )

  return "$($RepoUrl.TrimEnd('/'))/releases/download/$Tag/$FileName"
}

function Save-ReleaseAsset {
  param(
    [string]$Url,
    [string]$Destination
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $Destination
}

function Expand-ReleaseZip {
  param(
    [string]$ZipPath,
    [string]$Destination
  )

  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $Destination -Force
}

function Invoke-Installer {
  param(
    [string]$ScriptPath,
    [string[]]$Arguments = @()
  )

  Write-Host "Running $ScriptPath $($Arguments -join ' ')"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Installer failed: $ScriptPath ($LASTEXITCODE)"
  }
}

function Install-CoBrowser {
  param([string]$WorkRoot)

  $fileName = "cobrowser-$CoBrowserVersion.zip"
  $zipPath = Join-Path $WorkRoot $fileName
  $extractRoot = Join-Path $WorkRoot "cobrowser"
  $url = Resolve-ReleaseUrl -Tag "cobrowser-v$CoBrowserVersion" -FileName $fileName

  Save-ReleaseAsset -Url $url -Destination $zipPath
  Expand-ReleaseZip -ZipPath $zipPath -Destination $extractRoot

  $installer = Join-Path $extractRoot "cobrowser\scripts\install.ps1"
  $args = @("-Force")
  if ($SkipDependencies) {
    $args += "-SkipDependencies"
  }
  Invoke-Installer -ScriptPath $installer -Arguments $args
}

function Install-TikTokMonitor {
  param([string]$WorkRoot)

  $fileName = "tiktok-monitor-$TikTokMonitorVersion.zip"
  $zipPath = Join-Path $WorkRoot $fileName
  $extractRoot = Join-Path $WorkRoot "tiktok-monitor"
  $url = Resolve-ReleaseUrl -Tag "tiktok-monitor-v$TikTokMonitorVersion" -FileName $fileName

  Save-ReleaseAsset -Url $url -Destination $zipPath
  Expand-ReleaseZip -ZipPath $zipPath -Destination $extractRoot

  $installer = Join-Path $extractRoot "install.ps1"
  Invoke-Installer -ScriptPath $installer
}

function Invoke-CoBrowserDoctor {
  $scriptPath = Join-Path $env:USERPROFILE "plugins\cobrowser\scripts\cobrowser.mjs"
  if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "CoBrowser script not found: $scriptPath"
  }

  Write-Host "Running CoBrowser doctor"
  & node $scriptPath doctor --launch true --mode headless
  if ($LASTEXITCODE -ne 0) {
    throw "CoBrowser doctor failed with exit code $LASTEXITCODE"
  }
}

$plan = [pscustomobject]@{
  repoUrl = $RepoUrl
  coBrowser = if ($SkipCoBrowser) { "skip" } else { "install cobrowser $CoBrowserVersion" }
  tikTokMonitor = if ($SkipTikTokMonitor) { "skip" } else { "install tiktok-monitor $TikTokMonitorVersion" }
  skipDependencies = [bool]$SkipDependencies
  runDoctor = [bool]$RunDoctor
}

if ($PlanOnly) {
  $plan | ConvertTo-Json -Depth 5
  exit 0
}

$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) "tiktok-assistant-plugin-install"
New-Item -ItemType Directory -Force -Path $workRoot | Out-Null

if (-not $SkipCoBrowser) {
  Install-CoBrowser -WorkRoot $workRoot
}

if (-not $SkipTikTokMonitor) {
  Install-TikTokMonitor -WorkRoot $workRoot
}

if ($RunDoctor) {
  Invoke-CoBrowserDoctor
}

[pscustomobject]@{
  ok = $true
  installed = $plan
  next = @(
    "Restart Codex or refresh the plugin list.",
    "Run: node `"$env:USERPROFILE\plugins\cobrowser\scripts\cobrowser.mjs`" doctor --launch true --mode headless",
    "For TikTok login: node `"$env:USERPROFILE\plugins\cobrowser\scripts\cobrowser.mjs`" login --url `"https://www.tiktok.com/`"",
    "Then run: node `"$env:USERPROFILE\plugins\tiktok-monitor\scripts\setup.mjs`""
  )
} | ConvertTo-Json -Depth 8

