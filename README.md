# Cadence

Your AI coding rhythm, on your desktop. Cadence is a small always-on-top widget that reads the usage metadata Claude Code and Codex already write locally, and turns it into one contribution graph you can glance at while you work.

## Download for Windows

[**Download Cadence for Windows (x64)**](https://github.com/ndunl075/Cadence/releases/latest/download/cadence.exe)

Download `cadence.exe` and open it. The widget appears in the top-right corner of your primary display and floats above your other windows. Windows SmartScreen may show a warning because this early open-source build is not code-signed yet.

- Frameless panel that stays on top, drag it anywhere by its header
- Remembers its position, size, pinned state, metric, and provider between launches
- Claude-only in warm orange, Codex-only in signal blue, or both combined
- Month labels and a full date range, with per-day figures on hover
- A reference line that puts your total in human units — *~2,063 runs through the Harry Potter series*
- Rescans local logs every minute; click the timestamp to rescan now
- Optional local JSON API and README-ready SVG for sharing

Cadence never reads prompt text or source code into its reports. It only aggregates timestamps and token-count fields. No Anthropic or OpenAI API key is required.

### Widget controls

| Control | What it does |
| --- | --- |
| Header | Drag to move the panel |
| Pin | Toggle always-on-top; the pin tilts and dims when off |
| Timestamp | Force an immediate rescan (or `Ctrl+R`) |
| Bottom-left figure | Switch between SIGNAL and TOTAL (see below) |
| Reference line | Click for another comparison; it also rotates on its own |
| Minimize | Send to the taskbar (or `Esc`) |
| Close | Quit Cadence |

Drag any edge to resize. Cells scale to fit the width, so a wider panel shows a
larger graph rather than more empty space.

## Two ways to count

Click the bottom-left figure to switch the whole panel between two metrics. On a heavy Claude Code workload they differ by roughly 100x, and both are real:

| Metric | Counts | Typical scale |
| --- | --- | --- |
| **SIGNAL** | Fresh input + output only | ~26M |
| **TOTAL** | Adds cache reads and writes | ~3.0B |

Cache reads dominate — around 97% of raw volume — because every turn re-reads the conversation. `SIGNAL` is the default because:

1. **The providers disagree about `input_tokens`.** Anthropic reports it net of cache reads; Codex reports it gross, with cached tokens as a subset. Counting both raw inflates Codex roughly 35x against Claude on a shared scale. Cadence corrects for this.
2. **It is the only figure that reaches back through your whole history.** Claude Code prunes old transcripts but keeps per-day totals in `stats-cache.json`, and that file records input + output only — so backfilled days have no cache figures at all.

The API exposes both: every daily row carries `signal` and `tokens`, and the SVG accepts `?metric=tokens`.

## Full history and backfill

Transcripts on disk usually cover the last few weeks only. Cadence reaches further back by reading Claude Code's own rolling aggregate:

- Days covered by a transcript are computed from the transcript.
- Days that were pruned are filled in from `stats-cache.json` and marked with a hairline border in the graph, and "from stats cache" in their tooltip.
- Transcripts always win where both sources cover the same day.

The graph spans your entire recorded history, not one calendar year, so activity before January 1 is not dropped. Codex has no equivalent aggregate, so its history begins at your oldest surviving rollout file.

## Run from source

Requires Node.js 22+:

```sh
npm install
npm start
```

## Optional: local API and README embed

The widget does not need a server, but one is still included for sharing:

```sh
npm run server           # http://localhost:4173, no browser opened
npm run export           # write portable JSON and SVG into ./out
```

```text
GET  /api/v1/usage?provider=all      # add ?weeks=52 or ?year=2026 to narrow
GET  /api/v1/heatmap.svg?provider=all
GET  /api/v1/status
POST /api/v1/refresh
```

While Cadence is reachable at a public URL, embed it with:

```md
![My AI coding cadence](https://your-cadence.example/api/v1/heatmap.svg?provider=all)
```

For a no-server option, run `npm run export` and publish the generated SVG/JSON through GitHub Pages, a gist, or any static host. The public API deliberately contains aggregate counts only.

## Build the Windows executable

```sh
npm run build:exe
```

The result is `dist/cadence.exe`, a portable Electron build. GitHub releases built from version tags also attach a Windows x64 executable automatically.

## Data sources

Cadence currently scans:

- `~/.claude/projects/**/*.jsonl`
- `~/.config/claude/projects/**/*.jsonl`
- `~/.codex/sessions/**/*.jsonl`
- `~/.claude/stats-cache.json` (backfill for pruned days)

The parser deduplicates repeated Claude message snapshots and derives Codex increments from cumulative token events to avoid inflated totals.

## Inspiration

Cadence is inspired by [ccstat](https://github.com/ktny/ccstat) and [ccusage](https://github.com/ryoppippi/ccusage), particularly their local-first log discovery and daily aggregation. The implementation here is original and MIT licensed.

## License

MIT
