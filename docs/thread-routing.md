# Codex Thread Routing

This project keeps three long-running Codex conversations as operational workstreams. Each workstream now has a dedicated branch and worktree derived from the consolidated `main` branch.

The goal is to keep the old conversation context while avoiding the old scattered temporary worktrees.

## Routes

| Thread | Task | Branch | Worktree |
| --- | --- | --- | --- |
| `019e0c97-3cc0-7123-b12c-c0fb03202134` | TikTok monitoring, monitor plugin operation, collection context, Feishu/Base reports | `codex/thread-tiktok-monitor` | `C:\Users\EDY\Desktop\TikTok Project\.worktrees\thread-tiktok-monitor` |
| `019e086a-4d18-7262-9ba3-0432468371c2` | Content production, script workflow, GPT image prompts, private GPT and visual review rules | `codex/thread-content-production` | `C:\Users\EDY\Desktop\TikTok Project\.worktrees\thread-content-production` |
| `019e0d06-45b2-70b1-9db4-42a5a885bcea` | CoBrowser, shared source profile, ChatGPT/TikTok browser runtime, plugin packaging support | `codex/thread-browser-runtime` | `C:\Users\EDY\Desktop\TikTok Project\.worktrees\thread-browser-runtime` |

## Startup Rule For Agents

At the start of one of these old conversations, check `CODEX_THREAD_ID`. If it matches a route above, use the matching worktree path for all code and Git commands.

Use the helper:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\EDY\Desktop\TikTok Project\scripts\route-thread.ps1"
```

To route a specific thread manually:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\EDY\Desktop\TikTok Project\scripts\route-thread.ps1" -ThreadId "019e0c97-3cc0-7123-b12c-c0fb03202134"
```

The script prints the target branch and worktree. If the worktree is missing, it recreates it from the matching branch.

## Handoff Prompts

If Codex opens an old conversation in the wrong directory, send one of these once.

TikTok monitor thread:

```text
从现在开始，请在 C:\Users\EDY\Desktop\TikTok Project\.worktrees\thread-tiktok-monitor 继续本对话，确认分支 codex/thread-tiktok-monitor。不要再使用 C:\Users\EDY\Desktop\TikTok Project Monitor 或 __tmp_* worktree。
```

Content production thread:

```text
从现在开始，请在 C:\Users\EDY\Desktop\TikTok Project\.worktrees\thread-content-production 继续本对话，确认分支 codex/thread-content-production。不要再使用旧临时 worktree。
```

Browser runtime thread:

```text
从现在开始，请在 C:\Users\EDY\Desktop\TikTok Project\.worktrees\thread-browser-runtime 继续本对话，确认分支 codex/thread-browser-runtime。这个对话只处理 CoBrowser、共享 source profile、ChatGPT/TikTok 浏览器运行态和插件打包支持。
```

## Important Boundaries

- `main` remains the clean integration branch and GitHub release base.
- `monitoring_data/`, `outputs/`, browser profiles, generated media, tokens, cookies, and release zips stay uncommitted.
- The TikTok monitoring thread keeps its historical conversation context; the data folder is local and ignored.
- Codex application internals can hint a thread workspace, but the durable contract is this file plus the Git worktrees.
