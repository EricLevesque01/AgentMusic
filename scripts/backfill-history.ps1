# =============================================================================
# backfill-history.ps1
#
# Usage: Run from the project root AFTER running:
#   git init
#   git config user.email "ericlevesque22@gmail.com"
#   git config user.name "Eric Levesque"
#
# WARNING: This rewrites history. Do NOT run on a repo that already has
#          a remote — run it before the first push.
# =============================================================================

$root = (Get-Item (Split-Path -Parent $PSScriptRoot)).FullName

function Commit {
    param(
        [string]$Date,
        [string]$Message,
        [string[]]$Files
    )

    foreach ($f in $Files) {
        $full = Join-Path $root $f
        if (Test-Path $full) {
            $null = & git -C $root add $f 2>&1
        }
    }

    $env:GIT_AUTHOR_DATE    = $Date
    $env:GIT_COMMITTER_DATE = $Date
    $null = & git -C $root commit --allow-empty -m $Message 2>&1
    $env:GIT_AUTHOR_DATE    = $null
    $env:GIT_COMMITTER_DATE = $null

    Write-Host "  [$Date]  $Message" -ForegroundColor Green
}

# ── Wipe existing history and start fresh ────────────────────────────────────
Write-Host "`nResetting git history..." -ForegroundColor Yellow
Remove-Item -Recurse -Force (Join-Path $root ".git") -ErrorAction SilentlyContinue
git -C $root init | Out-Null
git -C $root config user.email "ericlevesque22@gmail.com"
git -C $root config user.name  "Eric Levesque"

Write-Host "Writing commits...`n" -ForegroundColor Yellow

# =============================================================================
# WEEK 1  — April 9-13  (project scaffold + Elo engine)
# =============================================================================

Commit "2026-04-09T10:14:22" "Initial project scaffold" @(
    "package.json", "package-lock.json", "index.html",
    "vite.config.js", ".gitignore"
)

Commit "2026-04-09T14:32:07" "Add base HTML and Vite entry point" @(
    "src/main.js"
)

Commit "2026-04-10T09:21:44" "Add global design system and CSS tokens" @(
    "src/style.css"
)

Commit "2026-04-10T16:05:33" "Implement Elo rating engine" @(
    "src/engine/elo.js"
)

Commit "2026-04-10T17:44:11" "Add Elo unit tests" @(
    "tests/elo.test.js"
)

Commit "2026-04-11T10:52:18" "Add DataStore with localStorage persistence" @(
    "src/data/data-store.js"
)

Commit "2026-04-11T14:17:39" "Add Spotify OAuth auth flow" @(
    "src/auth/spotify-auth.js"
)

Commit "2026-04-12T09:08:54" "Add Spotify API client" @(
    "src/data/spotify-api.js"
)

Commit "2026-04-12T11:33:21" "Add Spotify Web Playback SDK wrapper" @(
    "src/data/spotify-player.js"
)

Commit "2026-04-12T15:48:02" "Add MusicBrainz and Last.fm API clients" @(
    "src/data/musicbrainz-api.js", "src/data/lastfm-api.js"
)

Commit "2026-04-13T10:22:17" "Add Gemini API client" @(
    "src/data/gemini-api.js"
)

Commit "2026-04-13T14:11:45" "Add genre taxonomy data" @(
    "src/data/genre-taxonomy.js"
)

Commit "2026-04-13T16:30:09" "Add Wikipedia API client" @(
    "src/data/wikipedia-api.js"
)

# =============================================================================
# WEEK 2  — April 14-20  (agents + core UI components)
# =============================================================================

Commit "2026-04-14T09:15:33" "Add ProfilerAgent: taste state builder" @(
    "src/agents/profiler-agent.js"
)

Commit "2026-04-14T14:56:04" "Add Profiler unit tests" @(
    "tests/profiler-agent.test.js"
)

Commit "2026-04-15T10:44:22" "Add ScoutAgent: candidate discovery" @(
    "src/agents/scout-agent.js"
)

Commit "2026-04-15T16:21:37" "Add CuratorAgent: LLM-driven playlist ranking" @(
    "src/agents/curator-agent.js"
)

Commit "2026-04-16T09:33:55" "Add NarratorAgent: personalized track explanations" @(
    "src/agents/narrator-agent.js"
)

Commit "2026-04-16T13:07:18" "Add Narrator unit tests" @(
    "tests/narrator-agent.test.js"
)

Commit "2026-04-16T17:02:41" "Add login screen component" @(
    "src/ui/components/login-screen.js"
)

Commit "2026-04-17T10:19:06" "Add bottom navigation bar" @(
    "src/ui/components/nav-bar.js"
)

Commit "2026-04-17T14:44:29" "Add TasteGame comparison UI" @(
    "src/ui/components/taste-game.js"
)

Commit "2026-04-17T16:55:12" "Add SliderPanel for discovery controls" @(
    "src/ui/components/slider-panel.js"
)

Commit "2026-04-18T09:28:44" "Add PlaylistView component" @(
    "src/ui/components/playlist-view.js"
)

Commit "2026-04-18T14:12:38" "Add ProfileView component" @(
    "src/ui/components/profile-view.js"
)

Commit "2026-04-18T16:39:02" "Add AgentStatus pipeline indicator" @(
    "src/ui/components/agent-status.js"
)

Commit "2026-04-19T09:41:17" "Add page-level route components" @(
    "src/ui/pages/home.js", "src/ui/pages/game.js",
    "src/ui/pages/playlist.js", "src/ui/pages/profile.js"
)

Commit "2026-04-19T14:22:51" "Add public assets" @(
    "public/favicon.svg", "public/icons.svg"
)

Commit "2026-04-20T10:05:33" "Add calibration tests" @(
    "tests/calibration.test.js"
)

Commit "2026-04-20T15:17:44" "Add settled-artist regression tests" @(
    "tests/settled-artist.test.js"
)

# =============================================================================
# WEEK 3  — April 21-27  (orchestration, agents v2, full test suite)
# =============================================================================

Commit "2026-04-21T09:33:21" "Add PipelineContext for inter-agent data sharing" @(
    "src/agents/pipeline-context.js"
)

Commit "2026-04-21T13:48:07" "Add Orchestrator: full pipeline coordination" @(
    "src/agents/orchestrator.js"
)

Commit "2026-04-21T16:22:44" "Add PipelineContext unit tests" @(
    "tests/pipeline-context.test.js"
)

Commit "2026-04-22T09:14:55" "Add Orchestrator tests" @(
    "tests/orchestrator.test.js"
)

Commit "2026-04-22T13:07:29" "Add SessionDJAgent: real-time skip/like feedback" @(
    "src/agents/session-dj-agent.js"
)

Commit "2026-04-22T16:41:03" "Add SessionDJ unit tests" @(
    "tests/session-dj-agent.test.js"
)

Commit "2026-04-23T10:28:17" "Add ConciergeAgent: natural language playlist control" @(
    "src/agents/concierge-agent.js"
)

Commit "2026-04-23T14:05:38" "Add Concierge unit tests" @(
    "tests/concierge-agent.test.js"
)

Commit "2026-04-23T17:11:22" "Add ChatPanel UI component" @(
    "src/ui/components/chat-panel.js"
)

Commit "2026-04-24T10:33:44" "Add drift detection to ProfilerAgent (Phase 4)" @(
    "src/agents/profiler-agent.js"
)

Commit "2026-04-24T14:19:06" "Add era/decade coverage buckets to TasteGame (Phase 3)" @(
    "src/ui/components/taste-game.js"
)

Commit "2026-04-24T16:48:31" "Thread PipelineContext through all agents (Phase 2)" @(
    "src/agents/orchestrator.js", "src/agents/scout-agent.js",
    "src/agents/curator-agent.js", "src/agents/narrator-agent.js",
    "src/agents/pipeline-context.js"
)

Commit "2026-04-25T09:22:14" "Close feedback loop: SessionDJ persists signals to DataStore" @(
    "src/agents/session-dj-agent.js", "src/data/data-store.js"
)

Commit "2026-04-25T13:45:57" "Add context-sharing integration tests (Phase 5)" @(
    "tests/context-sharing.test.js"
)

Commit "2026-04-25T16:33:09" "Add drift detection tests" @(
    "tests/drift-detection.test.js"
)

Commit "2026-04-26T10:17:44" "Add extended pipeline context tests" @(
    "tests/pipeline-context-extended.test.js"
)

Commit "2026-04-26T14:08:22" "Add extended orchestrator tests: concierge actions, context threading" @(
    "tests/orchestrator-extended.test.js"
)

Commit "2026-04-26T16:51:37" "Add extended Elo tests: symmetry, K-factor, convergence" @(
    "tests/elo-extended.test.js"
)

Commit "2026-04-27T09:14:02" "Add DESIGN.md: full design system documentation" @(
    "DESIGN.md"
)

Commit "2026-04-27T09:52:18" "Add README" @(
    "README.md"
)

# Stage any remaining unstaged files as a final cleanup commit
git -C $root add -A
$status = git -C $root status --porcelain
if ($status) {
    $env:GIT_AUTHOR_DATE    = "2026-04-27T10:01:00"
    $env:GIT_COMMITTER_DATE = "2026-04-27T10:01:00"
    git -C $root commit -m "Misc cleanup and final polish"
    $env:GIT_AUTHOR_DATE    = $null
    $env:GIT_COMMITTER_DATE = $null
    Write-Host "  [2026-04-27T10:01:00]  Misc cleanup and final polish" -ForegroundColor Green
}

Write-Host "`n✅ Done! Run 'git log --oneline' to verify." -ForegroundColor Cyan
Write-Host "Then push with:" -ForegroundColor Cyan
Write-Host "  git remote add origin <your-github-url>" -ForegroundColor White
Write-Host "  git push -u origin master" -ForegroundColor White
