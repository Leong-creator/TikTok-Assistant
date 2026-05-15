param(
  [string]$PluginParent = "$env:USERPROFILE\plugins",
  [string]$MarketplacePath = "$env:USERPROFILE\.agents\plugins\marketplace.json",
  [switch]$SkipMarketplace,
  [switch]$SkipDependencies,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$PathValue) {
  return [System.IO.Path]::GetFullPath($PathValue)
}

function Copy-PluginTree {
  param(
    [string]$Source,
    [string]$Destination
  )

  $sourceFull = Resolve-FullPath $Source
  $destinationFull = Resolve-FullPath $Destination

  if ($sourceFull.TrimEnd("\") -ieq $destinationFull.TrimEnd("\")) {
    return
  }

  if ((Test-Path -LiteralPath $destinationFull) -and -not $Force) {
    throw "Destination already exists: $destinationFull. Re-run with -Force to replace it."
  }

  if (Test-Path -LiteralPath $destinationFull) {
    Remove-Item -LiteralPath $destinationFull -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destinationFull) | Out-Null
  $exclude = @("dist", "node_modules", ".git", ".DS_Store")
  Copy-Item -LiteralPath $sourceFull -Destination $destinationFull -Recurse -Force -Exclude $exclude
}

function Update-Marketplace {
  param(
    [string]$PathValue
  )

  $marketplaceFull = Resolve-FullPath $PathValue
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $marketplaceFull) | Out-Null

  if (Test-Path -LiteralPath $marketplaceFull) {
    $marketplace = Get-Content -Raw -LiteralPath $marketplaceFull | ConvertFrom-Json
  } else {
    $marketplace = [pscustomobject]@{
      name = "local-codex-plugins"
      interface = [pscustomobject]@{ displayName = "Local Codex Plugins" }
      plugins = @()
    }
  }

  $propertyNames = @($marketplace.PSObject.Properties.Name)

  if (-not ($propertyNames -contains "name")) {
    $marketplace | Add-Member -NotePropertyName name -NotePropertyValue "local-codex-plugins"
  } elseif (-not $marketplace.name) {
    $marketplace.name = "local-codex-plugins"
  }
  if (-not ($propertyNames -contains "interface")) {
    $marketplace | Add-Member -NotePropertyName interface -NotePropertyValue ([pscustomobject]@{ displayName = "Local Codex Plugins" })
  } elseif ($null -eq $marketplace.interface) {
    $marketplace.interface = [pscustomobject]@{ displayName = "Local Codex Plugins" }
  }
  if (-not ($propertyNames -contains "plugins")) {
    $marketplace | Add-Member -NotePropertyName plugins -NotePropertyValue @()
  } elseif ($null -eq $marketplace.plugins) {
    $marketplace.plugins = @()
  }

  $entry = [pscustomobject]@{
    name = "cobrowser"
    source = [pscustomobject]@{
      source = "local"
      path = "./plugins/cobrowser"
    }
    policy = [pscustomobject]@{
      installation = "AVAILABLE"
      authentication = "ON_INSTALL"
    }
    category = "Engineering"
  }

  $plugins = @($marketplace.plugins | Where-Object { $_.name -ne "cobrowser" })
  $plugins += $entry
  $marketplace.plugins = $plugins
  $json = ($marketplace | ConvertTo-Json -Depth 10) + "`n"
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($marketplaceFull, $json, $utf8NoBom)
}

function Install-Dependencies {
  param([string]$PluginDir)

  if ($SkipDependencies) {
    return "skipped"
  }

  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) {
    return "npm-not-found"
  }

  Push-Location $PluginDir
  try {
    & npm install --omit=dev
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed with exit code $LASTEXITCODE"
    }
    return "installed"
  } finally {
    Pop-Location
  }
}

$sourceRoot = Resolve-FullPath (Join-Path $PSScriptRoot "..")
$destinationRoot = Resolve-FullPath (Join-Path $PluginParent "cobrowser")

Copy-PluginTree -Source $sourceRoot -Destination $destinationRoot

if (-not $SkipMarketplace) {
  Update-Marketplace -PathValue $MarketplacePath
}

$dependencyStatus = Install-Dependencies -PluginDir $destinationRoot

$result = [pscustomobject]@{
  ok = $true
  pluginDir = $destinationRoot
  marketplacePath = $(if ($SkipMarketplace) { $null } else { Resolve-FullPath $MarketplacePath })
  dependencies = $dependencyStatus
  next = @(
    "Restart Codex.",
    "Run: node `"$destinationRoot\scripts\cobrowser.mjs`" doctor --launch true --mode headless",
    "For login: node `"$destinationRoot\scripts\cobrowser.mjs`" login --url `"https://chatgpt.com/`""
  )
}

$result | ConvertTo-Json -Depth 8
