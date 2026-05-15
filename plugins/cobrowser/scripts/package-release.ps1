param(
  [string]$OutputDir = "",
  [switch]$SkipTar
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$PathValue) {
  return [System.IO.Path]::GetFullPath($PathValue)
}

function Copy-ReleaseTree {
  param(
    [string]$Source,
    [string]$Destination
  )

  $excludeNames = @("dist", "node_modules", ".git", ".DS_Store", "Thumbs.db")
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null

  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    if ($excludeNames -contains $_.Name) {
      return
    }
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Destination $_.Name) -Recurse -Force
  }
}

function Get-Sha256 {
  param([string]$PathValue)

  $stream = [System.IO.File]::OpenRead((Resolve-FullPath $PathValue))
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = $sha.ComputeHash($stream)
      return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

$pluginRoot = Resolve-FullPath (Join-Path $PSScriptRoot "..")
$pluginJsonPath = Join-Path $pluginRoot ".codex-plugin\plugin.json"
if (-not (Test-Path -LiteralPath $pluginJsonPath)) {
  throw "Missing plugin manifest: $pluginJsonPath"
}

$pluginJson = Get-Content -Raw -LiteralPath $pluginJsonPath | ConvertFrom-Json
$name = $pluginJson.name
$version = $pluginJson.version
if ($name -ne "cobrowser") {
  throw "Expected plugin name 'cobrowser', got '$name'"
}
if (-not $version) {
  throw "Missing plugin version"
}

$dist = if ($OutputDir) { Resolve-FullPath $OutputDir } else { Join-Path $pluginRoot "dist" }
$stageRoot = Join-Path $dist "_stage"
$stagePlugin = Join-Path $stageRoot "cobrowser"
Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stagePlugin,$dist | Out-Null

Copy-ReleaseTree -Source $pluginRoot -Destination $stagePlugin

$zipPath = Join-Path $dist "cobrowser-$version.zip"
$tarPath = Join-Path $dist "cobrowser-$version.tar.gz"
$manifestPath = Join-Path $dist "cobrowser-$version-manifest.json"
$shaPath = Join-Path $dist "SHA256SUMS.txt"

Remove-Item -LiteralPath $zipPath,$tarPath,$manifestPath,$shaPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $stagePlugin -DestinationPath $zipPath -Force

if (-not $SkipTar) {
  Push-Location $stageRoot
  try {
    & tar -czf $tarPath cobrowser
    if ($LASTEXITCODE -ne 0) {
      throw "tar failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

$files = Get-ChildItem -LiteralPath $stagePlugin -Recurse -File | ForEach-Object {
  [pscustomobject]@{
    path = $_.FullName.Substring($stagePlugin.Length + 1).Replace("\", "/")
    bytes = $_.Length
  }
}

$releaseManifest = [pscustomobject]@{
  name = $name
  version = $version
  builtAt = (Get-Date).ToUniversalTime().ToString("o")
  author = "Leong"
  artifacts = @(
    [pscustomobject]@{ path = $zipPath; sha256 = Get-Sha256 $zipPath }
  )
  files = $files
}

if (Test-Path -LiteralPath $tarPath) {
  $releaseManifest.artifacts += [pscustomobject]@{
    path = $tarPath
    sha256 = Get-Sha256 $tarPath
  }
}

$releaseManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$hashLines = @()
foreach ($artifact in $releaseManifest.artifacts) {
  $hashLines += "$($artifact.sha256)  $(Split-Path -Leaf $artifact.path)"
}
$hashLines | Set-Content -LiteralPath $shaPath -Encoding ASCII

Remove-Item -LiteralPath $stageRoot -Recurse -Force

[pscustomobject]@{
  ok = $true
  name = $name
  version = $version
  dist = $dist
  artifacts = $releaseManifest.artifacts
  manifest = $manifestPath
  checksums = $shaPath
} | ConvertTo-Json -Depth 8
