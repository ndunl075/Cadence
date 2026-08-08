# Cadence

Your AI coding rhythm, on your desktop. Cadence is a small always-on-top widget that reads the usage metadata Claude Code and Codex already write locally, and turns it into one contribution graph you can glance at while you work.

## Download for Windows

[**Download Cadence for Windows (x64)**](https://github.com/ndunl075/Cadence/releases/latest/download/cadence.exe)

Download `cadence.exe` and open it. The widget tucks into the top-left corner of your primary display and floats above your other windows. Windows SmartScreen may show a warning because this early open-source build is not code-signed yet.

- Frameless panel that stays on top, drag it anywhere by its header
- Remembers its position, size, pinned state, metric, and provider between launches
- Claude-only in Anthropic orange, Codex-only in Codex blue, or combined with each day coloured by whichever agent did more of it
- Month labels and a full date range, with per-day figures on hover
- A reference line that puts your total in human units — *~2,063 runs through the Harry Potter series*
- Rescans local logs every minute; click the timestamp to rescan now
- Optional local JSON API and README-ready SVG for sharing

Cadence never reads prompt text or source code into its reports. It only aggregates timestamps and token-count fields. No Anthropic or OpenAI API key is required.

### Widget controls

Window controls sit at the top-left; the live indicator and wordmark at the top-right.

| Control | Where | What it does |
| --- | --- | --- |
| Close | top-left | Quit Cadence |
| Minimize | top-left | Send to the taskbar (or `Esc`) |
| Pin | top-left | Toggle always-on-top; the pin tilts and dims when off |
| Settings | top-left | Open the settings sheet (or `Ctrl+,`) |
| Timestamp | top-right | Force an immediate rescan (or `Ctrl+R`) |
| Provider row | below header | Switch between combined, Claude, and Codex |
| Bottom-left figure | readout | Switch between SIGNAL and TOTAL (see below) |
| Reference line | bottom | Click for another comparison; it also rotates on its own |

Drag the header to move the panel and any edge to resize. Cells scale to fit the
width, so a wider panel shows a larger graph rather than more empty space.

### Settings

The gear opens a sheet over the graph. It stops below the title bar, so the pin,
minimize and quit buttons stay reachable while it is open; `Esc` backs out of the
sheet before it minimizes the window.

| Setting | Options | Effect |
| --- | --- | --- |
| **Appearance** | System *(default)*, Light, Dark | Repaints the panel. System follows Windows and switches live when you do. |
| **Rescan logs** | 30s, 1m *(default)*, 5m, 15m | How often transcripts are re-read. Longer intervals touch the disk less. |
| **Headline metric** | Signal *(default)*, Total | Same switch as clicking the bottom-left figure. |
| **Keep on top** | on *(default)* | Same as the pin button; the two stay in sync. |
| **Start with Windows** | off *(default)* | Registers Cadence as a login item. |
| **Cycle comparisons** | on *(default)* | Turn off to stop the reference line rotating by itself. |

Settings are stored in `widget-state.json` in Electron's per-user data directory
and never leave the machine. The main process is what actually holds them: the
panel sends a patch, the main process clamps every value to a known option,
applies it, and sends back what really took effect — so the sheet shows the true
state even when the OS refuses something, such as a login item blocked by policy.

Light mode is a re-grounded panel rather than an inversion. Both heatmap ramps
are re-cut to run pale to saturated, so density still reads as weight on paper
the way it reads as glow on the dark panel.

### Reading the colours

Intensity is a log scale across five steps. The palettes are not approximations
of each brand — they are the products' own design tokens:

| Provider | Ramp | Source |
| --- | --- | --- |
| **Claude** | `#4b1b08` → `#993d19` → `#c25124` → `#eb6834` | Anthropic `--orange-750/-550/-450/-350` |
| **Codex** | `#00284d` → `#0257a7` → `#0285ff` → `#70baff` | OpenAI `--blue-900` and `--blue-400`, two steps interpolated at the same hue |

The Claude accent dot is `#d97757` — Anthropic's `--clay`, and the body colour
of Clawd, the Claude Code mascot.

**The combined view colours each day by who did the work.** A day where Codex
ran more tokens than Claude is painted in Codex blue; a Claude-heavy day is
painted in Anthropic orange. Intensity still encodes volume, so the graph tells
you *how much* and *which agent* at the same time, and a stretch where you
switched tools is visible at a glance. Ties go to Claude, which also covers
Claude-only days. The legend shows both ramps in this view, one per provider,
and the tooltip bolds whichever side led that day.

Lightness increases strictly across every ramp, so a busier day is never darker
than a quieter one. Peak days carry a soft glow in their own hue. Every cell is
a single flat colour — days backfilled from the stats cache used to carry a
hairline border, but a long backfilled stretch ringed every square and broke the
flat colour the graph is read by, so that distinction lives in the tooltip
instead. The SVG endpoint applies the same per-day ownership rule.

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

## The reference line

The strip along the bottom restates whichever total you are showing in units a
person can actually picture, drawn from 74 reference works and activities:

```text
≈ 2,063 runs through the Harry Potter series
≈ 38 copies of the Oxford English Dictionary
≈ 48% of all of English Wikipedia
≈ 4.9 copies of the US tax code
≈ 8.9 days of nonstop typing
```

References span novels and series, short works, founding documents and
speeches, reference works up to the whole of English Wikipedia, sustained
reading and speaking and typing rates, screenplays and TED talks, and everyday
writing down to a single text message. Cadence picks the two dozen that land on
a graspable multiple for your total and cycles through them, so the line stays
meaningful whether you are on your first day or your billionth token. Click it
to advance immediately.

Word counts are commonly cited figures converted at roughly 4/3 tokens per
English word. They are deliberately approximate — hence the `≈`.

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
node src/server.js --cors    # allow other origins to read the API
node src/server.js --help    # all flags
```

The API is loopback-only and same-origin-only unless you opt out with `--cors`
and `--host`. See [Security posture](#security-posture).

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

## How it works

Cadence has no account, no server, and no API key. Claude Code and Codex both
already write a log of every turn to your own disk; Cadence reads those files,
adds up the token-count fields, and draws the result. Nothing is sent anywhere.

### 1. Finding your logs

On launch (and once a minute after), Cadence walks these locations. Anything
missing is skipped, so you only need one of the two agents installed.

**Claude Code** — first match wins, all are checked:

| Path | When it applies |
| --- | --- |
| `$CLAUDE_CONFIG_DIR/projects` | You've set Claude Code's config override (several dirs allowed, separated by `:` on macOS/Linux or `;` on Windows) |
| `~/.claude/projects` | The default on every platform |
| `$XDG_CONFIG_HOME/claude/projects` | Linux, if you use XDG |
| `~/.config/claude/projects` | Older layouts |

**Codex:** `$CODEX_HOME/sessions`, then `~/.codex/sessions`.

`~` is your real home directory — `C:\Users\you` on Windows. Roots that resolve
to the same folder are collapsed, so an override pointing at the default cannot
count your usage twice.

### 2. Reading the numbers

**Claude** transcripts are JSONL, one object per line. Cadence looks only at
assistant entries carrying `message.usage`, and reads five fields:
`input_tokens`, `output_tokens`, `cache_read_input_tokens`,
`cache_creation_input_tokens`, and the timestamp. A streamed reply is written
several times as it grows, so entries are deduplicated by message id, keeping
the largest. Subagent transcripts under `subagents/` are counted — that work is
genuinely separate and does not appear in the parent session.

**Codex** rollout files report a running total per session, not per turn, so
Cadence diffs consecutive `token_count` events to recover what each turn
actually cost. It also compensates for a real difference between the two
products: Anthropic reports `input_tokens` net of cache reads, Codex reports it
gross with `cached_input_tokens` as a subset. Counting both as-is would inflate
Codex by roughly 35x on a shared graph.

### 3. Filling the gaps

Claude Code prunes old transcripts, so on most machines they only reach back a
few weeks. Cadence recovers the rest from Claude Code's own rolling aggregate at
`stats-cache.json`, which keeps per-day token counts long after the transcripts
are gone. Those days are marked with a hairline border and say "from stats
cache" in the tooltip. Transcripts always win where both cover the same day.

Codex has no equivalent aggregate, so its history starts at your oldest
surviving rollout file.

### What Cadence never reads

Only timestamps and numeric token counts leave the parser. Prompts, responses,
file contents, file paths, and project names are never read into a report, never
written to disk, and never transmitted. The panel makes no network requests at
all — you can confirm that by pulling your network cable and watching it keep
working.

The exported JSON is the whole data model, and it is dates and integers:

```json
{ "date": "2026-08-07", "signal": 309090, "tokens": 309090,
  "providers": { "claude": { "signal": 309090 }, "codex": { "signal": 0 } } }
```

### Security posture

The widget itself opens no ports and speaks to nothing. The optional server is
built to stay private by default:

- **Bound to `127.0.0.1`.** Not reachable from your network unless you pass `--host`.
- **No cross-origin reads.** Without this, any page you happened to be browsing could `fetch` your usage off localhost. Pass `--cors` when you actually intend to publish the graph.
- **Host header checked.** A loopback bind refuses requests addressed to any other hostname, so a hostile domain cannot point its DNS at `127.0.0.1` and read your data as same-origin.
- **Static files are contained** to `public/`, verified against encoded and doubled traversal attempts.

The Electron shell runs with `contextIsolation` on and `nodeIntegration` off,
under a `default-src 'none'` CSP. It refuses to navigate away from its own page,
refuses to attach webviews, and only ever hands `http(s)` URLs to the OS. The
renderer is treated as the untrusted side of the bridge: every setting it sends
is clamped to a known value in the main process before anything reaches disk or
the OS.

CI actions are pinned to full commit SHAs rather than tags. A tag is a mutable
pointer — whoever controls an action's repository can retarget `v4` at new code,
and that code then runs in our workflow with our token. The release job holds
`contents: write`, so it is the one that would hurt; the workflow now grants that
permission only to the job that needs it, and the repository default is read-only.

These are covered by tests in `test/server.test.js`, which boot the real server
and assert each one.

### If your graph looks empty

- The agent may store logs somewhere non-default — check `CLAUDE_CONFIG_DIR` and `CODEX_HOME`.
- Codex only started writing rollout files in recent versions; older installs have nothing to read.
- Run `npm run server` and open `/api/v1/status`, which reports how many session files were found for each provider.

## Inspiration

Cadence is inspired by [ccstat](https://github.com/ktny/ccstat) and [ccusage](https://github.com/ryoppippi/ccusage), particularly their local-first log discovery and daily aggregation. The implementation here is original and MIT licensed.

## License

MIT
