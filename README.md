# Branchlog

A local-first desktop notebook. Each day is a page of checkbox tasks on an infinite canvas.

This repository is in **Phase 3**: the desktop shell, the daily page, same-day branches, and cross-day carry and branch links. Phases 1, 2, 4, 5 and 6 are done — the activity calendar, images (paste, drop, move, resize, crop, delete) and the LM Studio margin comments are built. So is the concept map: `Cmd/Ctrl+M` opens one node per carried task, expandable into its copies.

## Setup

```bash
npm install
npm run dev
```

`postinstall` runs `electron-rebuild -f -w better-sqlite3` so the native module is built for Electron rather than the system Node. Electron's Node ABI is not the same as the `node` on your PATH, which is why a plain `npm install` of `better-sqlite3` is not enough on older releases.

`better-sqlite3` 13 ships an N-API prebuild per platform. Electron can load that binary without a compiler. If `electron-rebuild` cannot find Visual Studio Build Tools (Windows) or a C++ toolchain, install still finishes and the app uses that prebuild. Install the "Desktop development with C++" workload if you want the rebuild itself to succeed. The project path should not matter for the prebuild; compiling from source is unreliable when the path contains spaces.

## Scripts

- `npm run dev` — open the app with hot reload
- `npm run build` — compile main, preload, and renderer
- `npm run typecheck` — TypeScript strict check
- `npm run lint` — oxlint
- `npm test` — build, then run the Playwright suite against the real app. The AI specs point at a local mock LM Studio server, never a model

## Data

The SQLite file is `branchlog.sqlite` inside `app.getPath('userData')`.

- Windows: `%APPDATA%\branchlog\branchlog.sqlite`
- macOS: `~/Library/Application Support/branchlog/branchlog.sqlite`
- Linux: `~/.config/branchlog/branchlog.sqlite`

On startup the app copies that file into `backups/` once per day and keeps the last 7 copies. Window size and position are stored beside it in `window-state.json`.

The app loads no remote content and needs no account. The one outbound call it can make is to the LM Studio address you configure under Settings → AI margin (`http://localhost:1234/v1` by default), and only the main process makes it. Margin comments stay off until you turn them on, the AI never edits your task text, and every phrase it keeps or hides is stored as offsets on your own machine.

The renderer never opens the database itself; it talks to the main process through the preload bridge.
