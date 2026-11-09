# Branchlog — agent handoff

Facts below are from the working tree on 2026-11-08 (code, tests, `package.json`, `package-lock.json`, git). `README.md` still says Phase 2 and that images come later. That is stale. Anything not confirmed is marked **unverified**.

## 1. Project in 5 lines

Branchlog is a local-first desktop notebook (Electron + React + TypeScript). Each day is checkbox tasks on an infinite canvas; a branch dot grows same-day work to the right, with arrows.

Two different cross-day links are in progress. **Carry** copies the same unfinished task onto a later day (`carriedFromId`, same `chainId`). **Branch** creates a new task on today from an earlier one (`parentId`). A concept map, a GitHub-style activity calendar, and LM Studio margin comments are specified in `BRANCHLOG.md` and `DESIGN.md` and are not built. Pasted images are partly built.

The planned AI talks to LM Studio on the machine, comments in the margin, and never edits the user's text. No AI client exists, so that rule is specified, not implemented.

Data stays in SQLite under the app user-data folder, with a daily backup that keeps 7 copies (`src/main/backup.ts`).

## 2. Stack and commands

App version `0.1.0`. Versions are the lockfile, not the `^` ranges.

| Package | Locked |
|---|---|
| electron | 45.2.3 |
| electron-vite | 6.0.0 |
| vite (via electron-vite) | 8.3.6 |
| react / react-dom | 19.3.1 |
| typescript | 7.0.2 |
| @xyflow/react | 12.12.1 |
| zustand | 5.1.0 |
| better-sqlite3 | 13.0.3 |
| tailwindcss | 4.3.5 |
| @playwright/test | 1.65.0 |
| oxlint | 1.92.0 |
| date-fns | 4.4.0 |
| lucide-react | 1.70.0 |

| Command | What it does |
|---|---|
| `npm install` | Installs, then `postinstall` → `scripts/rebuild-native.cjs` |
| `npm run dev` | `electron-vite dev` |
| `npm run build` | Compile main, preload, renderer to `out/` |
| `npm run typecheck` | `tsc --noEmit` for node and web projects |
| `npm run lint` | `oxlint` |
| `npm test` | Same as `test:e2e`: `electron-vite build` then Playwright |
| `npm run test:e2e` | The only test script |

There is no `package` script and no electron-builder config. Windows, macOS, and Linux installers are not set up. `scripts/measure-first-paint.mjs` can copy the Electron dist, asar-pack `out/`, and rename `electron.exe` to `Branchlog.exe` for timing. It hardcodes `win32-x64`. That is a measurement harness, not Phase 7.

The renderer hot-reloads under `npm run dev`. Main (`src/main`) and preload (`src/preload`) do not hot-reload into the page. Tests set `ELECTRON_RENDERER_URL` empty and launch the built app, so they only see a fresh `electron-vite build` (the test script does that build).

`better-sqlite3` must match Electron's ABI. `postinstall` runs `electron-rebuild -f -w better-sqlite3`. If the compile fails and `prebuilds/<platform>-<arch>.node` exists, the script keeps that N-API prebuild and exits 0. This checkout's path contains spaces; compiling from source is unreliable here. Electron can load the prebuild without a C++ toolchain.

A production build replaces `src/shared/clock.ts` with `src/shared/clock-off.ts` (`electron.vite.config.ts`). Dev and `npm test` keep the real `clock.ts`, which honors `BRANCHLOG_NOW`.

## 3. File structure

```
src/main/                 Electron main. Only process that opens SQLite.
  index.ts                Window, boot, user-data override
  schema.ts               CREATE TABLE text. database.ts applies it
  database.ts             Task queries
  migrate.ts              Older tables, carry columns, chain index, orphan cleanup
  task-row.ts             Shared SELECT column list and row mapping
  validate.ts             Every IPC payload is parsed here
  ipc.ts                  Channel registration
  day-sync.ts             Replace one day's rows (undo), including carry links
  task-tree.ts            Delete and restore. The SQL is in task-delete.ts
  task-delete.ts          Delete descendants, relink the carry chain, restore
  carry.ts                Copy unfinished tasks forward. dropTask lives here, unwired
  carry-schedule.ts       Run carry at startup, focus, resume, and local midnight
  carry-link.ts           Keep carriedFromId valid when a copy is deleted
  continuation.ts         New task on today from an earlier parent
  images.ts               Paste PNG, list the day's images
  layout-save.ts          Positions after separation settles
  settings.ts             autoSeparate, swipeToPan
  theme-store.ts          settings.theme JSON
  menu.ts                 System menu. Several items are disabled
  context-menu.ts         Edit + spelling context menu
  security.ts             CSP and webPreferences hardening
  backup.ts               Daily SQLite copy, keep 7
  window-state.ts         window-state.json
src/preload/              Only file that may call ipcRenderer / contextBridge
  index.ts                window.branchlog
  theme-boot.ts           Sync theme read, style tag before first paint
src/renderer/src/         React page. Talks to the notebook only via window.branchlog
  main.tsx                Mounts App
  App.tsx                 Shortcuts, menu actions, error boundary
  temp-first-paint.ts     Startup probes. Still in the tree
  components/             One component per file. Daily canvas is DailyCanvas.tsx
                          Also EarlierSearch.tsx, ContinuationMark.tsx
  lib/                    Non-component helpers
  store/                  useNotebook and the write queue
  styles/globals.css      Color tokens actually painted
  styles/theme-lab.css    Theme Lab panel
src/shared/               Types and dates. No Electron, no React
  types.ts                Task, images, IPC shapes, type guards
  dates.ts                localDateKey, addDays, next local midnight
  clock.ts                The only now(). Test clock
  clock-off.ts            Production now()
  task-life.ts            open / done / dropped / carried / superseded. The page does not render it yet
  separate.ts             Rectangle separation. No React, no SQL
  theme.ts                Token list, default palettes, theme-row checks
tests/                    Playwright. launch.ts is the shared app launcher
scripts/rebuild-native.cjs
scripts/measure-first-paint.mjs
```

Renderer components: `DailyCanvas.tsx` (React Flow), `MainListNode.tsx`, `BranchNode.tsx`, `TaskBullet.tsx`, `ImageNode.tsx`, `DateHeader.tsx`, `TopBar.tsx`, `DeleteNotice.tsx`, `ThemeLab.tsx`, `ThemeLabTools.tsx`, `ThemeTokenList.tsx`.

Store: `notebook.ts` (open day, plus `continuations`), `history.ts` (undo, `recordCarry`), `carry-sync.ts`, `continuation.ts`, `images.ts`, `task-size.ts`, `preferences.ts`, `layout-commit.ts`, `layout-bridge.ts`, `delete-task.ts`, `delete-notice.ts`, `removed.ts`. Styles: `continuation.css`.

| Cross-cutting thing | Where it lives |
|---|---|
| Focus a new field | `focusRequest` / `focusAt` on `useNotebook`. `useTaskFieldFocus` in `lib/field-focus.ts` applies it via `lib/focus-field.ts`. Creates set the request inside `createTask` / `createBranch`. |
| Create a task | Not one function. Main-list rows: `useNotebook.createTask` → `tasks.createSync`. Same-day branches: `useNotebook.createBranch` → `tasks.createBranchSync`. A new task from an earlier day: `store/continuation.ts` → `tasks:createContinuation`. Callers: `lib/task-keys.ts` (Enter), `lib/new-task.ts` (Ctrl/Cmd+N), `lib/branch-from.ts` (dot and Alt+Enter; an earlier day calls the continuation path). The renderer mints ids with `crypto.randomUUID()`. Carry copies are minted in `src/main/carry.ts`, not in the renderer. |
| Today's date | `now()` in `src/shared/clock.ts`, `localDateKey()` in `src/shared/dates.ts`. The header uses `lib/today.ts` (midnight, focus, wake on `clock:resume`). |
| Undo / redo | `src/renderer/src/store/history.ts`. Dropped when the day changes. Theme Lab undo is separate, in `lib/theme-engine.ts`. |
| Color tokens | Painted defaults in `styles/globals.css`. Saved theme and the token list in `src/shared/theme.ts`. Hex outside `globals.css`, `theme-lab.css`, and `theme.ts` fails `tests/theme-source.spec.ts`. |

`nodeTypes` is a module-level constant in `DailyCanvas.tsx`. Node `data` is `{}`. Nodes read the task from the store.

Several files are already past the ~300-line guide: `notebook.ts`, `history.ts`, `globals.css`, `MainListNode.tsx`, `DailyCanvas.tsx`. Put new behavior in a new file.

## 4. Architecture

Renderer → `useNotebook` (or `useImages`) → `window.branchlog` (preload type-checks the reply) → `ipc.ts` → `validate.ts` → `database.ts` / `images.ts` / `task-tree.ts` → SQLite. The row comes back the same way. Creates wait for SQLite and show the row the database returned. Text, position, and branch size update the store immediately and write after 200ms. A failed text save is tried once more (800ms), then the store shows an error. Checking a box waits for IPC and rolls the store back on failure. Closing the window calls `flushPendingSync`.

Dragging does not write. `onNodeDrag` does not call `window.branchlog`. `onNodeDragStop` calls `updatePosition` once. Resize of a branch is the same: size is recorded on pointer-up, then the 200ms write in `task-size.ts`.

`branchlog.sqlite` is `app.getPath('userData')/branchlog.sqlite`. WAL, foreign keys on. Tests pass `--branchlog-profile` / `BRANCHLOG_USER_DATA` and must keep doing that.

| Table | Key columns | Used by the app |
|---|---|---|
| `tasks` | id, text, done, dateCreated, dateCompleted, parentId (cascade), x, y, width, height, side (`main` \| `right`), orderIndex, carriedFromId, chainId, droppedAt | Yes. `x`/`y`/`width`/`height` are the daily canvas. Main list ignores size. Unique `(chainId, dateCreated)`. `chainId` defaults to the row id via trigger `tasks_fill_chain`. |
| `images` | id, dateKey, fileName, x, y, width, height, cropLeft, cropTop, cropRight, cropBottom | Yes. File is `userData/images/<id>.png`. Crop columns are trimmed fractions; the file is never rewritten. |
| `settings` | key, value | Yes: `autoSeparate`, `swipeToPan`, `theme`, `autoCarry` (on unless the value is `0`), `carryWindowDays` (default 14, else 0–3660). No settings UI for the carry keys. |
| `mapPositions` | taskId, x, y | Table only. No map UI reads it. Delete/restore keeps the rows. |
| `aiComments` | id, taskId, side (`left` only), text, status (`open` \| `resolved`), keptRanges, x, y, createdAt | Table only. No queries from the UI. |
| `aiReplies` | id, commentId, role (`user` \| `ai`), text, createdAt | Table only. |

Do not break:

- The renderer never opens the database, and never imports `electron`, `better-sqlite3`, `node:fs`, or `src/main`.
- The preload never runs SQL. The main process never draws the page.
- Every IPC input is validated in `validate.ts` before it reaches SQLite.
- Positions save once at the end of a drag, never per frame. Do not rebuild nodes or edges while `draggingId` is set.
- Deleting a task deletes all descendants on every day, in one transaction, and is undoable (`task-tree.ts`, `DeleteNotice.tsx`). Images are not attached to a task, so a delete does not remove them. AI rows and `mapPositions` go away by foreign key.
- Edges are derived from `parentId`. They are not saved.
- A same-day branch is `side: 'right'` plus `parentId`, stored on the parent's `dateCreated` (`createBranch` in `database.ts`).
- A cross-day **branch** is a new row on today (`side: 'main'`, `carriedFromId` null, its own `chainId`) whose `parentId` is the earlier task (`continuation.ts`). The earlier day is not rewritten. `ContinuationMark` is the dot for that link.
- A **carry** is a copy, not a move. New id, same text, same `chainId`, `carriedFromId` points at the source row. The source stays on its day.
- All painted colors come from tokens. Do not put a hex in a component.
- Task fields do not live in React Flow `data`, in a second store, or in component state.
- One owner per fact. See `ARCHITECTURE.md`.

## 5. Plan and status

| Item | Status | Evidence |
|---|---|---|
| **Phase 1. Desktop scaffold and daily page** | **Done** | Electron window, menu, SQLite, React Flow page |
| Checkbox bullets | Done | `TaskBullet.tsx`, `tests/task-editing.spec.ts` |
| Enter splits; Shift+Enter breaks the line; Backspace on an empty task deletes it | Done | `lib/task-keys.ts`, `task-editing.spec.ts`, `task-enter-focus.spec.ts` |
| Persistence per date | Done | `tasks:listByDate`, `goToDate`, restart checks in `task-branch-caret.spec.ts` |
| **Phase 2. Same-day branching** | **Done** | |
| Branch dot, branches on the right, arrows | Done | `TaskBullet.tsx` (`Branch from this task`), `canvas-graph.ts`, `BranchNode.tsx` |
| Dragging | Done | `DailyCanvas.tsx` `onNodeDragStop`; `task-undo.spec.ts` restores a moved branch |
| Resize branch nodes only | Done | `NodeResizer` only in `BranchNode.tsx`. Main list is skipped in `onNodesChange`. `task-branch-size.spec.ts` |
| Delete with descendants, undoable | Done | `task-tree.ts`, `tests/task-delete.spec.ts`, `DeleteNotice.tsx` |
| Alt+Enter | Done | `menu.ts`, `lib/branch-from.ts`, `task-enter-focus.spec.ts` |
| Collision avoidance | Done | `src/shared/separate.ts`, `tests/separate.spec.ts`, `tests/task-separate.spec.ts`. Setting `autoSeparate`, on when the row is missing |
| **Phase 3. Cross-day links and Concept Map** | **Partial** | Carry and branch are different. See the rules under this table |
| Branch: a new task from an earlier one | Done | `continuation.ts`, `EarlierSearch.tsx` (Cmd/Ctrl+K), branch dot on an earlier day (`branch-from.ts`), `ContinuationMark.tsx`, `tests/task-continuation.spec.ts`. Menu item is enabled. Same-day `createBranch` is unchanged |
| Carry: the same unfinished task onto a later day | Partial | `carry.ts`, `carry-schedule.ts`, `carry-sync.ts`. Automatic copy at startup, focus, resume, and midnight. No Playwright spec. `dropTask` has no IPC and no page |
| Concept Map | Not started | Menu item disabled (`CmdOrCtrl+M`). `mapPositions` is never drawn |
| **Phase 4. Activity calendar** | **Not started** | Menu item disabled. No calendar component. `dateCompleted` is set to the local date when a box is checked (`updateTask`), and `--active-0` / `--active-1` exist in `globals.css` |
| **Phase 5. Images** | **Done** | |
| Paste anywhere on the canvas | Done | `lib/paste-image.ts`, `images.ts`, `ImageNode.tsx`. Accepts PNG/JPEG bitmaps, browser "copy image" (html alongside), and copied image files (via `text/uri-list`). A rejected paste shows an error. Longest edge capped at 480. `task-separate.spec.ts` ("a pasted image separates"), `image-paste.spec.ts` |
| Move | Done | Drag stop calls `useImages.move` |
| Drag and drop image files | Done | `lib/drop-image.ts`, `images:drop` channel (`dropImage` in `src/main/images.ts`), `tests/image-drop.spec.ts`. Bytes are read in the renderer and decoded in main like a paste. Non-image drops show an error |
| Resize | Done | `NodeResizer` in `ImageNode.tsx` (corners, aspect kept), `images:resize` channel, `resize` in `store/images.ts`, `tests/image-resize.spec.ts` |
| Crop | Done | Non-destructive. `cropLeft/cropTop/cropRight/cropBottom` fractions on the row (`migrate-images.ts`), `ImageCrop.tsx` side handles behind a Crop toggle, math in `lib/image-crop.ts`, saved through `images:resize`, undo via image history, `tests/image-crop.spec.ts`. The PNG file is never rewritten |
| **Phase 6. LM Studio margin comments** | **Not started** | No client, no comment UI. Schema allows `side = 'left'` only (the plan's user-initiated right side does not fit). Status is `open` \| `resolved` (no `dismissed`). Tokens `--ai`, `--ai-soft`, `--ai-line`, `--edge-ai` exist. Production CSP `connect-src` is `'self'` only (`security.ts`), so localhost LM Studio would be blocked until that changes |
| **Phase 7. Packaging** | **Not started** | No installer script. Export and Import menu items are `enabled: false`. The first-paint script can assemble a Windows folder only |

Extras, outside the phases:

| Extra | Status | Evidence |
|---|---|---|
| Undo / redo | Done | `store/history.ts`, `tests/task-undo.spec.ts`, Edit menu. Theme undo is a second stack (`theme-lab-store.spec.ts`) |
| Hierarchy-aware copy and paste | Partial | Cross-task copy/cut joins main-list lines with newlines (`lib/list-edit.ts`, `task-clipboard.spec.ts`). A multi-line paste stays in one task (that spec asserts it). Nothing rebuilds a parent/child tree from the clipboard. Enter on a branch does create a sibling branch (`task-enter-focus.spec.ts`) |
| Theme Lab | Done | `ThemeLab.tsx`, `lib/theme-engine.ts`, `theme-store.ts`, `theme-lab.spec.ts`, `theme-lab-store.spec.ts`, `theme-lab-perf.spec.ts`, `theme-source.spec.ts`. Shortcut Ctrl/Cmd+Shift+T |
| Trackpad swipe-to-pan | Done | `lib/canvas-navigation.ts`, setting `swipeToPan`, `tests/canvas-pan.spec.ts`. Viewport is not saved |
| Startup performance work | Partial | `temp-first-paint.ts`, `src/shared/temp-timing.ts`, `scripts/measure-first-paint.mjs`, `first-paint-results/*.json`. Probes are still compiled in. `tempCountRender` increments a counter even when not measuring. No written report |
| Test suite | Done | Playwright only. See Testing. Carry has no spec |

**We are currently in Phase 3; the next step is the carry "let go" state, then closing the chain when a later copy is finished.**

### Phase 3 rules in force

These are the decisions for the work underway. The code only partly matches them. Do not invent a second link type.

**Carry and branch stay different.** Carry is the same task continuing (`carriedFromId` + shared `chainId`). Branch is a new task (`parentId` across dates). On the Concept Map, draw the two links differently.

| Decision | What to build | What is there now |
|---|---|---|
| Carry is a copy, not a move. The source day keeps its row | Keep | `carryForward` inserts a new row. The source is not updated |
| Dropped is the escape. Struck through, and never carried again | Page control that calls `dropTask` / `undropTask` | Columns and functions exist. No IPC, no strike-through on the daily page. Candidates already skip `droppedAt` |
| Carry a task with its unfinished branches. Leave finished branches behind | Keep | A right-side child is copied beside its parent only when that parent is also copied. A finished row (`dateCompleted` set) is not a candidate. An unfinished branch whose parent is not copied becomes a main-list row and keeps the old `parentId` |
| Automatic carry, or ask each morning ("3 unfinished. Bring forward?") | A setting. Automatic is the simple default; asking is the calmer one | `autoCarry` defaults on. There is no prompt and no settings UI. Window is `carryWindowDays`, default 14 |
| Finishing the latest copy marks every earlier copy. Unchecking that latest copy reopens them all | One checkbox write updates the chain | `updateTask` writes only the row you clicked |
| An earlier copy finished this way looks different from a task finished on its own day: "finished later, on Nov 9", tooltip, click jumps to that day | Marker plus tooltip, not a new meaning piled onto color alone | Not built. `taskLife` has `superseded` (a later row in the chain exists). That is not "finished later" |
| The calendar counts only the day the work was actually completed | When Phase 4 is built, one `dateCompleted` lights one day | `dateCompleted` is the local date of that single checkbox write. Calendar UI is not started |
| No branch from a finished task | Refuse in `branch-from.ts`, `createContinuation`, and `EarlierSearch` | Not enforced. Search still lists done tasks, struck through, and a click still continues them |
| Carried tasks: a small marker and "carried N days" on hover. Age tint is optional and a setting. Do not add another required color (AI teal, done, finished-later, and carried is too many) | Marker like the continuation dot. Tint only if the setting is on | Not built. `ContinuationMark` is only the branch-from-earlier dot |
| Concept Map: one node per chain, badge "N days", expand on click | New view. Do not grow `DailyCanvas.tsx` | Not started |
| Task state is one of: open, done, finished later, carried, dropped | Derive it. Do not store a second copy of the same fact | Stored facts are `dateCompleted`, `droppedAt`, `carriedFromId`, and "a later row shares `chainId`". `src/shared/task-life.ts` is the classifier. The page does not use it yet |

Carry runs in the main process (`installCarrySchedule` from `index.ts`) and the page adopts the rows in `useCarrySync` / `recordCarry`. There is no Playwright coverage for carry. Do not treat that path as tested.

## 6. Known bugs and open issues

No `TODO` or `FIXME` in source. No `test.skip` or `test.fixme`. The suite was not run for this document, so a green or red `npm test` is **unverified**.

| Sev | Issue | Where |
|---|---|---|
| High, unverified | First word on a blank day sometimes comes back shortened or scrambled (`origin` → `gino`). The spec is fully commented out, so Playwright never runs it. | `tests/task-first-word.spec.ts`. Caret logic that may be involved: `lib/focus-field.ts` |
| Medium | E2E launch hardcodes `node_modules/electron/dist/electron.exe`. macOS and Linux launches will not find that file. | `tests/launch.ts` |
| Low | `EDITOR_AUDIT.md` is stale. Undo, Up/Down, Escape, context menu, direction, and focus rings now have specs (`task-undo`, `task-navigation`, `task-a11y`). The audit still says those are missing. Multi-line paste still does not split into bullets; the clipboard spec locks that | `EDITOR_AUDIT.md` vs those specs |
| Low | Startup probes were meant to be removed after a report. There is no `FIRST_PAINT_REPORT.md`. JSON runs live in `first-paint-results/` | `temp-first-paint.ts`, `temp-timing.ts` |
| Low | A failed `autoSeparate` or `swipeToPan` read is returned as `true`, so a broken settings read looks like the feature is on | `src/main/ipc.ts` |
| Low | `README.md` says Phase 2 and that images, the map, the calendar, and AI are all later. Images and Theme Lab are already in the tree | `README.md` |

`COLOR_AUDIT.md` is a finished token pass, not an open bug list. `transparent`, `none`, and the system `Highlight` keywords were left on purpose. No `HEALTH_REPORT.md` or `TEST_COVERAGE.md`.

`first-paint-results/summary.json` is raw timings from a measurement machine. It is not a conclusion. Do not treat its seeded row counts as a user's notebook.

## 7. Testing

`playwright.config.ts`: `tests/`, one worker, not parallel, 60s test timeout, 10s expect. `npm test` builds, then runs every `*.spec.ts`.

`tests/launch.ts` starts the built app against a temp profile and is the shared launcher. `closeApp` kills the process. On Windows it also taskkills by pid and by the profile path.

| Spec | Covers |
|---|---|
| `dates.spec.ts` | `localDateKey` and midnight. No Electron window. Spawns `date-zone-cli.ts` |
| `separate.spec.ts` | Rectangle separation. No window |
| `theme-source.spec.ts` | No raw colors outside the token files. Reads source, and built CSS if `out/` exists |
| `today.spec.ts` | "Today" label, midnight, daylight saving, time zone. Uncommitted |
| `task-editing.spec.ts` | Typing, Backspace, paste as plain text, caret |
| `task-navigation.spec.ts` | Up/Down between main-list bullets, Escape |
| `task-a11y.spec.ts` | Direction, tab, focus ring, spellcheck, edit menu, context menu |
| `task-clipboard.spec.ts` | Multi-line paste stays one bullet; cut across tasks |
| `task-undo.spec.ts` | Undo/redo of text, paste, split, delete, checkbox, move |
| `task-delete.spec.ts` | Descendants, including a hand-inserted other-day child; orphan cleanup on startup |
| `task-enter-focus.spec.ts` | Enter, Alt+Enter, Ctrl/Cmd+N, focus of the new field |
| `task-continuation.spec.ts` | Branch dot on an earlier day, and the earlier-task search, write today and leave that day unchanged |
| `task-branch-caret.spec.ts` | Branch-dot click focuses the new branch; text survives restart |
| `task-branch-size.spec.ts` | Wrap, resize, arrow on the checkbox; default size for an old notebook |
| `task-separate.spec.ts` | Auto-separate for create, drop, resize, text growth, images; undo; setting off |
| `image-paste.spec.ts`, `image-drop.spec.ts`, `image-resize.spec.ts`, `image-crop.spec.ts` | Paste from clipboard flavors and copied files, file drop with its error, corner resize with undo and restart, crop of two sides with undo, redo, and restart |
| `canvas-pan.spec.ts` | Swipe-to-pan, pinch zoom, setting survives restart |
| `theme-lab.spec.ts`, `theme-lab-store.spec.ts`, `theme-lab-perf.spec.ts` | Theme Lab edits, presets, import, undo, first frame, drag does not re-render nodes |
| `task-first-word.spec.ts` | Commented out. Not collected |

Rule: every feature or bug fix ships with tests for exactly that feature. Do not add tests for a feature that is not built. Do not weaken a test to make it pass. The workspace rule also asks for `npm run typecheck` and `npm run lint` before you call a task done. `npm test` does not run those.

## 8. Working rules

- Read `.cursor/rules/branchlog.mdc`, `DESIGN.md`, and `BRANCHLOG.md` before a UI or feature change. If you add or move a layer, a data owner, an IPC channel, or a table, update `ARCHITECTURE.md` in the same change.
- A new IPC channel is added together in `src/shared/types.ts`, `src/preload/index.ts`, `src/main/validate.ts`, and `src/main/ipc.ts`. The query stays in `database.ts` (or the one module that already owns that table).
- Diagnose the root cause before fixing a bug. No workarounds. A `try/catch` may surface a failure, roll back, or rethrow. It must not swallow the error and continue. Do not add `setTimeout`, `requestAnimationFrame`, or `queueMicrotask` to paper over a race. The 200ms timers in the store batch writes. They are not a bug-fix pattern.
- Change only what the task asks. No unrelated reformatting. One component per file.
- Use the shared mechanisms in the table above. Do not write a second focus path, a second create path, a second `now()`, a second undo stack for tasks, or a second palette.
- Run `npm test` before finishing and report the result. Also run typecheck and lint.
- Git: if another agent may be working at the same time, show `git status` first. Stage only the files you changed. Never `git add .` or `git commit -a`. Prefer a separate branch or worktree. Do not commit unless the user asked.
- Never read or edit real user data. Do not open `userdata/`, `branchlog.sqlite`, or `backups/`. Tests use a temporary profile from `launch.ts`.

## 9. Git state

Branch `main`. A full `git status` was not repeated for this edit. Confirmed from `git log -5` and a path-limited status:

- `5328dcd` Branch an earlier task onto today without rewriting that earlier day.
- `01e8868` Show Today only on the current local day.
- `fe9b9c9` Add Theme Lab so color tokens can be edited live without shifting the default palette.
- `853dd37` Pan the daily canvas with a trackpad swipe, and keep pinch and modifier-scroll zoom.
- `c4a7221` Record the first-paint measurement runs, their packaged builds, and the profiles from those runs.

`src/main/continuation.ts` is modified. `src/main/carry.ts` is untracked, and other carry files may be too. Run `git status` before staging. Do not `git add .`.

`userdata/` is on disk. Do not read it.

## 10. Where to start

1. **Let a carried task go.** Wire `dropTask` and `undropTask` through `types.ts`, `preload/index.ts`, `validate.ts`, and `ipc.ts`. On the daily page, strike the task through and stop carry from copying that chain. Add a Playwright spec. `carry.ts` already skips `droppedAt`.

2. **Finishing the latest copy closes the chain.** In `updateTask` (`database.ts`), checking the latest row sets every earlier copy in the `chainId` to done, with `dateCompleted` equal to the day you actually finished (so a future calendar lights that day only). Unchecking that latest row clears them. Earlier copies need a "finished later, on {date}" tooltip and a jump, built from `task-life.ts` plus a marker. Do not add a required new color.

3. **Refuse a branch from a finished task.** `lib/branch-from.ts`, `createContinuation` in `continuation.ts`, and `EarlierSearch.tsx` (`choose` still runs for a struck-through done row). Cover it in `tests/task-continuation.spec.ts`.

After those: the carried-days marker (hover "carried N days", age tint only behind a setting), then the Concept Map as one node per `chainId` with an "N days" badge. Image resize (Phase 5) is done: corners with the aspect kept, saved through `images:resize`.
