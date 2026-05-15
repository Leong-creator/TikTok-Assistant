[CmdletBinding()]
param(
  [string]$ThreadId = $env:CODEX_THREAD_ID,
  [switch]$List
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

$Routes = @(
  [pscustomobject]@{
    ThreadId = "019e0c97-3cc0-7123-b12c-c0fb03202134"
    Name = "TikTok monitor"
    Branch = "codex/thread-tiktok-monitor"
    WorktreePath = (Join-Path $RepoRoot ".worktrees\thread-tiktok-monitor")
    Task = "TikTok monitoring, monitor plugin operation, collection context, Feishu/Base reports"
  },
  [pscustomobject]@{
    ThreadId = "019e086a-4d18-7262-9ba3-0432468371c2"
    Name = "Content production"
    Branch = "codex/thread-content-production"
    WorktreePath = (Join-Path $RepoRoot ".worktrees\thread-content-production")
    Task = "Content production, script workflow, GPT image prompts, private GPT and visual review rules"
  },
  [pscustomobject]@{
    ThreadId = "019e0d06-45b2-70b1-9db4-42a5a885bcea"
    Name = "Browser runtime"
    Branch = "codex/thread-browser-runtime"
    WorktreePath = (Join-Path $RepoRoot ".worktrees\thread-browser-runtime")
    Task = "CoBrowser, shared source profile, ChatGPT/TikTok browser runtime, plugin packaging support"
  }
)

if ($List) {
  $Routes | ConvertTo-Json -Depth 4
  exit 0
}

if ([string]::IsNullOrWhiteSpace($ThreadId)) {
  throw "No ThreadId was provided and CODEX_THREAD_ID is not set."
}

$Route = $Routes | Where-Object { $_.ThreadId -eq $ThreadId } | Select-Object -First 1
if (-not $Route) {
  [pscustomobject]@{
    ready = $false
    threadId = $ThreadId
    message = "No project route is configured for this thread."
  } | ConvertTo-Json -Depth 4
  exit 2
}

function Test-GitRef {
  param([string]$Ref)
  & git -C $RepoRoot rev-parse --verify --quiet $Ref *> $null
  return $LASTEXITCODE -eq 0
}

if (-not (Test-GitRef $Route.Branch)) {
  & git -C $RepoRoot branch $Route.Branch main
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create branch $($Route.Branch) from main."
  }
}

if (-not (Test-Path -LiteralPath $Route.WorktreePath)) {
  & git -C $RepoRoot worktree add $Route.WorktreePath $Route.Branch
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create worktree $($Route.WorktreePath)."
  }
}

$CurrentBranch = (& git -C $Route.WorktreePath branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect worktree branch at $($Route.WorktreePath)."
}

if ($CurrentBranch -ne $Route.Branch) {
  throw "Worktree $($Route.WorktreePath) is on $CurrentBranch, expected $($Route.Branch)."
}

[pscustomobject]@{
  ready = $true
  threadId = $Route.ThreadId
  name = $Route.Name
  task = $Route.Task
  branch = $Route.Branch
  worktreePath = $Route.WorktreePath
  currentBranch = $CurrentBranch
  nextCommand = "Set-Location -LiteralPath `"$($Route.WorktreePath)`""
} | ConvertTo-Json -Depth 4
