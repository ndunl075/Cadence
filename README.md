# Cadence

Your AI coding rhythm, visualized. Cadence reads the local usage metadata already written by Claude Code and Codex, then turns it into one GitHub-style contribution graph.

## Download for Windows

[**Download Cadence for Windows (x64)**](https://github.com/ndunl075/Cadence/releases/latest/download/cadence.exe)

Download `cadence.exe`, open it, and Cadence will launch in your browser. Windows SmartScreen may show a warning because this early open-source build is not code-signed yet.

- Claude-only heatmap in warm orange
- Codex-only heatmap in signal blue
- Combined view for your full agent workflow
- Local JSON API and README-ready SVG endpoint
- Static demo mode for the hosted landing page
- Single-file Windows build

Cadence never reads prompt text or source code into its reports. It only aggregates timestamps and token-count fields. No Anthropic or OpenAI API key is required.

## Run it

Requires Node.js 22+ for development:

```sh
npm install
npm start
```

Cadence opens at `http://localhost:4173` and rescans local logs every minute.

```sh
# Do not open a browser
node src/server.js --no-open

# Write portable JSON and SVG files
node src/server.js --export ./out
```

## API and README embed

```text
GET /api/v1/usage?provider=all
GET /api/v1/usage?provider=claude
GET /api/v1/usage?provider=codex
GET /api/v1/heatmap.svg?provider=all
GET /api/v1/status
POST /api/v1/refresh
```

While Cadence is reachable at a public URL, embed it with:

```md
![My AI coding cadence](https://your-cadence.example/api/v1/heatmap.svg?provider=all)
```

For a no-server option, run `--export` and publish the generated SVG/JSON through GitHub Pages, a gist, or any static host. The public API deliberately contains aggregate counts only.

## Build the Windows executable

```sh
npm run build:exe
```

The result is `dist/cadence.exe`. GitHub releases built from version tags also attach a Windows x64 executable automatically.

## Hosting the demo

The `public/` directory is a standalone demo: if the local API is unavailable, it switches to clearly labelled sample data. It can be deployed directly to GitHub Pages or another static host. Running it through `src/server.js` replaces the sample with real local data.

## Data sources

Cadence currently scans:

- `~/.claude/projects/**/*.jsonl`
- `~/.config/claude/projects/**/*.jsonl`
- `~/.codex/sessions/**/*.jsonl`

The parser deduplicates repeated Claude message snapshots and derives Codex increments from cumulative token events to avoid inflated totals.

## Inspiration

Cadence is inspired by [ccstat](https://github.com/ktny/ccstat) and [ccusage](https://github.com/ryoppippi/ccusage), particularly their local-first log discovery and daily aggregation. The implementation here is original and MIT licensed.

## License

MIT
