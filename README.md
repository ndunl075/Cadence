# Cadence

Your AI coding rhythm, on your desktop. Cadence is a small always-on-top widget that reads the usage metadata Claude Code, Codex and Cursor already write locally, and turns it into one contribution graph you can glance at while you work. There is a terminal version of the same graph — see [one command, one graph](#one-command-one-graph).

## Download for Windows

[**Download Cadence for Windows (x64)**](https://github.com/ndunl075/Cadence/releases/latest/download/cadence.exe)

Download `cadence.exe` and open it. The widget tucks into the top-left corner of your primary display and floats above your other windows. Windows SmartScreen may show a warning because this early open-source build is not code-signed yet.

- Frameless panel that stays on top, drag it anywhere by its header
- Remembers its position, size, pinned state, metric, and provider between launches
- One agent on its own, or all three combined with each day coloured by whichever did more of it
- Month labels and a full date range, with per-day figures on hover
- A reference line that puts your total in human units — *~2,063 runs through the Harry Potter series*
- Rescans local logs every minute; click the timestamp to rescan now
- The same graph in your terminal, plus an optional local JSON API and README-ready SVG

Cadence never reads prompt text or source code into its reports. It only aggregates timestamps and token-count fields. No Anthropic, OpenAI or Cursor API key is required.

Releases also carry `cadence-win-x64.zip`, the same app as a plain folder. Prefer
it if you mainly want the command line: the portable `.exe` is a self-extracting
wrapper that does not hand the app your shell's pipe, so `cadence.exe graph`
cannot be piped or redirected. See [one command, one graph](#one-command-one-graph).

### Widget controls

Window controls sit at the top-left; the live indicator and wordmark at the top-right.

| Control | Where | What it does |
| --- | --- | --- |
| Close | top-left | Quit Cadence |
| Minimize | top-left | Send to the taskbar (or `Esc`) |
| Pin | top-left | Toggle always-on-top; the pin tilts and dims when off |
| Settings | top-left | Open the settings sheet (or `Ctrl+,`) |
| Timestamp | top-right | Force an immediate rescan (or `Ctrl+R`) |
| Provider row | below header | Switch between combined, Claude, Codex, and Cursor |
| Bottom-left figure | readout | Switch between SIGNAL and TOTAL (see below) |
| Reference line | bottom | Click for another comparison; it also rotates on its own |

Drag the header to move the panel and any edge to resize. Cells scale to fit the
width, so a wider panel shows a larger graph rather than more empty space.

## One command, one graph

The same graph, drawn in the terminal. No window, no server, nothing to leave
running:

```sh
cadence
```

```text
Claude + Codex + Cursor cadence SIGNAL
167,304,294 tokens · 114 active days · 21 day streak

      NOV       DEC     JAN 2026  FEB     MAR     APR     MAY       JUN     JUL     AUG
    · · · █ █ █ · ▓ ▓ ▓ · █ ▓ · · · · ▓ · · · · · · · · · · · · · · · · · · · ▓ ▓ █ █ █
Mon █ █ ▓ █ █ · · ▓ · █ ▓ █ · · · · · · · · · · · · · · · · · · · · · · · ▓ · ▓ · █ ▒ █
    █ ▓ █ · █ · █ · ▓ █ · █ · ▓ · · · · · · · · · · · · · · · · · · · · · · ▓ █ █ █ █ ▓
Wed █ █ █ █ █ █ █ ▓ █ █ █ █ · · ▒ · · · · · · · · · · · · · · · · · · · ▓ █ ▓ █ ▓ █ █ █
    █ █ █ █ · · ▓ · █ █ ▓ █ · ▓ · · · ▒ · · · · · · · · · · · · · · · · ▓ · · █ ▓ █ █ █
Fri ▓ █ █ █ █ · █ ▓ █ · █ █ · · · · ▒ · · · · · · · · · · · · · · · · · █ ▒ █ ▓ · █ ▓ █
    ▓ █ █ · █ · · ▓ █ · · █ ▓ · · · ▒ · · · · · · · · · · · · · · · · · █ · █ █ · █ ▓ █

Less · ░ ▒ ▓ █ More                                              2025-10-19 — 2026-08-08
≈ 28 runs through The Wheel of Time
```

That is the plain-text form, as it comes out of a pipe. On a terminal the cells
carry the same colours as the panel — so a day is orange, blue or grey depending
on which agent did the most of it — and the legend becomes one ramp per
provider. With no window flag the graph fits your terminal, showing as much
recent history as there is room for and saying so when it had to trim.

| | |
| --- | --- |
| `cadence` or `cadence graph` | draw the graph |
| `cadence json` | the same report the API serves, for scripting |
| `cadence svg` | the README-ready SVG |
| `-p, --provider <name>` | `all` *(default)*, `claude`, `codex`, `cursor` |
| `-m, --metric <name>` | `signal` *(default)* or `tokens` — see [two ways to count](#two-ways-to-count) |
| `-w, --weeks <n>` | the last *n* weeks |
| `--year <yyyy>` | one calendar year |
| `--since <yyyy-mm-dd>` | everything from a date onwards |
| `--full` | all recorded history, even if it is wider than the terminal |
| `-o, --out <file>` | write to a file instead of stdout |
| `--ascii` | plain ASCII instead of block glyphs |
| `--color` / `--no-color` | force colour on or off; `NO_COLOR` is honoured |

Colour is on for a terminal and off for a pipe, so `cadence graph > graph.txt`
is plain text. Exit status is `0`, or `2` for a bad flag.

### From a clone

```sh
npm install
npm run graph -- --weeks 12      # or: npx . --weeks 12
npm link                         # then `cadence` anywhere
```

### From the Windows download

The executable answers the same commands — `cadence.exe graph`, `cadence.exe
--help` — and opens the widget when given no arguments, so one file does both.
Two Windows details are worth knowing:

- **The portable `cadence.exe` cannot be piped or redirected.** It is a
  self-extracting wrapper that launches the real app without passing on your
  shell's stdout, so `cadence.exe graph > out.txt` writes an empty file. Use
  `cadence.exe graph --out out.txt`, or take `cadence-win-x64.zip` from the same
  release and run `Cadence.exe graph`, which pipes normally.
- **Your shell will not wait for it.** Windows does not block on a windowed
  program, so the prompt returns before the graph prints. `Start-Process -Wait
  -NoNewWindow .\cadence.exe -ArgumentList graph` waits; so does piping.

If the graph comes out grey when you expected colour, pass `--color`: a
GUI-subsystem binary cannot always tell that it is attached to a terminal.

### Settings

The gear opens a sheet over the graph. It stops below the title bar, so the pin,
minimize and quit buttons stay reachable while it is open; `Esc` backs out of the
sheet before it minimizes the window.

| Setting | Options | Effect |
| --- | --- | --- |
| **Appearance** | Dark *(default)*, Light, System | Repaints the panel. System follows Windows and switches live when you do. |
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
| **Cursor** | `#3f434a` → `#6a707a` → `#9aa1ac` → `#d8dee6` | Cursor publishes no colour scale — its mark is monochrome — so it takes a neutral grey cut to the same four steps |

The Claude accent dot is `#d97757` — Anthropic's `--clay`, and the body colour
of Clawd, the Claude Code mascot.

Cursor's is the one ramp with no hue to carry it, so its steps are spaced on
lightness alone and it ends brighter than the other two. On the light theme it
runs the other way, pale slate down to near-black, so a busy day is still the
heaviest mark on the page rather than the lightest.

**The combined view colours each day by who did the work.** A day where Codex
ran more tokens than the others is painted in Codex blue, a Cursor-heavy day in
grey, a Claude-heavy day in Anthropic orange. Intensity still encodes volume, so
the graph tells you *how much* and *which agent* at the same time, and a stretch
where you switched tools is visible at a glance. Ties go to Claude, which also
covers Claude-only days. The legend shows all three ramps in this view, one per
provider, and the tooltip bolds whichever side led that day.

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

### Cursor reads high, and is not corrected

Cursor records only `inputTokens` and `outputTokens` per turn, with no cached
figure to subtract, and its input is the whole prompt for that turn — the
context re-sent every time. It is therefore the same gross number Codex reports,
except that here there is nothing to correct it with.

So a Cursor day sits high against a Claude day of comparable work, and on a
machine that has used both heavily Cursor can be most of the combined total.
That is a real count of real tokens, not a bug, but it is not directly
comparable to the other two. Cadence counts it as reported rather than scaling
it by a guess. Its `TOTAL` equals its `SIGNAL` for the same reason: no cache
figures exist to add. Click **CURSOR** in the rail, or pass
`--provider cursor`, to read it on its own scale.

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

Requires Node.js 22.5+, for the built-in SQLite that reads Cursor's store:

```sh
npm install
npm start                # the widget
npm run graph            # the same graph in the terminal
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
GET  /api/v1/usage?provider=all      # or claude / codex / cursor; ?weeks=52, ?year=2026
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

That writes two artifacts, and GitHub releases built from version tags attach
both automatically:

| Artifact | What it is |
| --- | --- |
| `dist/cadence.exe` | One portable file. The widget download; its CLI mode needs `--out` (see [above](#from-the-windows-download)) |
| `dist/cadence-win-x64.zip` | The same app as a plain folder. `Cadence.exe graph` behaves like any other console program |

## How it works

Cadence has no account, no server, and no API key. All three agents already
record every turn on your own disk; Cadence reads what they wrote, adds up the
token-count fields, and draws the result. Nothing is sent anywhere.

### 1. Finding your logs

On launch (and once a minute after), Cadence walks these locations. Anything
missing is skipped, so you only need one of the three agents installed.

**Claude Code** — first match wins, all are checked:

| Path | When it applies |
| --- | --- |
| `$CLAUDE_CONFIG_DIR/projects` | You've set Claude Code's config override (several dirs allowed, separated by `:` on macOS/Linux or `;` on Windows) |
| `~/.claude/projects` | The default on every platform |
| `$XDG_CONFIG_HOME/claude/projects` | Linux, if you use XDG |
| `~/.config/claude/projects` | Older layouts |

**Codex:** `$CODEX_HOME/sessions`, then `~/.codex/sessions`.

**Cursor** keeps no transcript files. Being a VS Code fork, its chat history
lives in one SQLite store where the editor would keep any other state — not in
the `~/.cursor` directory that holds its extensions and projects:

| Path | When it applies |
| --- | --- |
| `$CURSOR_HOME/User/globalStorage/state.vscdb` | You've pointed Cadence at a specific Cursor profile |
| `%APPDATA%\Cursor\User\globalStorage\state.vscdb` | Windows |
| `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | macOS |
| `$XDG_CONFIG_HOME/Cursor/…` or `~/.config/Cursor/…` | Linux |

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

**Cursor** stores each chat turn as a row in the `cursorDiskKV` table, keyed
`bubbleId:<chat>:<turn>`, holding a JSON blob. Two fields out of that blob are
read — `tokenCount` and `createdAt` — and the store is opened read-only. Turns
whose count is zero are the user's own and the bookkeeping rows around them, so
the query discards them in SQLite rather than parsing tens of thousands of blobs
to find the ones that matter; the same turn seen in two profiles is counted once
by its `usageUuid`. That store runs to a gigabyte or more on a well-used
machine, so the extracted rows are cached and only re-read when the file or its
write-ahead log actually changes. A store locked by a running Cursor, or written
by a schema Cadence does not recognise, costs you the Cursor ramp and nothing
else. Reading it needs `node:sqlite`, which means Node 22.5 or newer; the
Windows build ships its own.

### 3. Filling the gaps

Claude Code prunes old transcripts, so on most machines they only reach back a
few weeks. Cadence recovers the rest from Claude Code's own rolling aggregate at
`stats-cache.json`, which keeps per-day token counts long after the transcripts
are gone. Those days are marked with a hairline border and say "from stats
cache" in the tooltip. Transcripts always win where both cover the same day.

Neither Codex nor Cursor keeps an equivalent aggregate. Codex's history starts
at your oldest surviving rollout file; Cursor's reaches as far back as the chats
still in its store, which is usually further, because it prunes nothing.

### What Cadence never reads

Only timestamps and numeric token counts leave the parser. Prompts, responses,
file contents, file paths, and project names are never read into a report, never
written to disk, and never transmitted. The panel makes no network requests at
all — you can confirm that by pulling your network cable and watching it keep
working.

Cursor's store is the one source that holds whole conversations rather than a
line per turn, and it is opened read-only. Four values are taken out of each
turn: two token counts, a timestamp, and the id used to avoid counting a turn
twice. The chat text sits in the same blob and is never parsed out of it.

The exported JSON is the whole data model, and it is dates and integers:

```json
{ "date": "2026-08-07", "signal": 309090, "tokens": 309090,
  "providers": { "claude": { "signal": 309090 }, "codex": { "signal": 0 },
                 "cursor": { "signal": 0 } } }
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

- The agent may store logs somewhere non-default — check `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `CURSOR_HOME`.
- Codex only started writing rollout files in recent versions; older installs have nothing to read.
- Cursor needs `node:sqlite`, so a clone run on Node older than 22.5 will show the other two and no Cursor.
- `cadence json` reports what was found under `sources` — session files for Claude and Codex, chats for Cursor. `npm run server` and `/api/v1/status` say the same thing.

## Inspiration

Cadence is inspired by [ccstat](https://github.com/ktny/ccstat) and [ccusage](https://github.com/ryoppippi/ccusage), particularly their local-first log discovery and daily aggregation. The implementation here is original and MIT licensed.

## License

MIT
