# Branchlog

A local-first desktop notebook. Each day is a page of checkbox tasks on an infinite canvas.

This repository is in **Phase 1**: the desktop shell and the daily page. Branching, the concept map, the calendar, images, and LM Studio comments come in later phases.

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

## Data

The SQLite file is `branchlog.sqlite` inside `app.getPath('userData')`.

- Windows: `%APPDATA%\branchlog\branchlog.sqlite`
- macOS: `~/Library/Application Support/branchlog/branchlog.sqlite`
- Linux: `~/.config/branchlog/branchlog.sqlite`

On startup the app copies that file into `backups/` once per day and keeps the last 7 copies. Window size and position are stored beside it in `window-state.json`.

The app is offline. It does not load remote content. The renderer never opens the database itself; it talks to the main process through the preload bridge.
