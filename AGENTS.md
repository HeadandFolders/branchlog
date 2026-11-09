# Branchlog — agent handoff

Facts below are from the working tree on 2026-11-09 (code, tests, `package.json`, `package-lock.json`, git). `README.md` still says Phase 2 and that images come later. That is stale. Anything not confirmed is marked **unverified**.

## 1. Project in 5 lines

Branchlog is a local-first desktop notebook (Electron + React + TypeScript). Each day is checkbox tasks on an infinite canvas; a branch dot grows same-day work to the right, with arrows.

Two different cross-day links are in progress. **Carry** copies the same unfinished task onto a later day (`carriedFromId`, same `chainId`). **Branch** creates a new task on today from an earlier one (`parentId`). LM Studio margin comments are built (Phase 6 / Stage 6), and so is the activity calendar. The concept map is specified in `BRANCHLOG.md` and `DESIGN.md` and is not built. Pasted images are built (Phase 5).

The AI talks to LM Studio at the address the user configures (`http://localhost:1234/v1` by default), comments in the left margin, answers an explicit Ask AI in a right-side branch, and never edits the user's text. `src/main/lm-studio.ts` is the only code that opens a socket; the renderer never fetches. Comments are off until the user turns them on in the AI settings panel (Ctrl/Cmd+comma).

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
  carry.ts                Copy unfinished tasks forward. dropTask and undropTask are wired to `tasks:setDropped`. Also reads and writes the `autoCarry` row
  carry-schedule.ts       Run carry at startup, focus, resume, and local midnight. carryOnDemand runs it when autoCarry is switched on
  carry-link.ts           Keep carriedFromId valid when a copy is deleted
  continuation.ts         New task on today from an earlier parent
  images.ts               Paste PNG, list the day's images
  layout-save.ts          Positions after separation settles
  settings.ts             autoSeparate, swipeToPan, highlightCarried
  theme-store.ts          settings.theme JSON
  menu.ts                 System menu. Several items are disabled
  context-menu.ts         Edit + spelling context menu
  security.ts             CSP and webPreferences hardening
  backup.ts               Daily SQLite copy, keep 7
  window-state.ts         window-state.json
  ai-settings-store.ts    The `settings.ai` row. Only main reads or writes it
  lm-studio.ts            The only outbound network call in the app: /models and /chat/completions
  ai-store.ts             aiComments / aiReplies queries, the per-day left-comment cap, restore and replace
  ai-comment.ts           One automatic left comment: context, prompt, parse, save
  ai-ask.ts               An explicit Ask AI answer inside a right-side branch
  ai-context.ts           Bounded day and lineage context: 5 ancestors, 30 tasks, 2000 chars
  ai-prompts.ts           The four system prompts and the message builders
  ai-parse.ts             Model JSON in, text or null out, with length caps
  ai-validate.ts          Payload parsing for the AI request channels
  ai-flight.ts            One 'auto' slot plus one shared 'user' slot; a newer request aborts the older
  ai-request-ipc.ts       ai:requestComment, ai:ask, ai:reply, ai:cancel
src/preload/              Only file that may call ipcRenderer / contextBridge
  index.ts                window.branchlog
  theme-boot.ts           Sync theme read, style tag before first paint
src/renderer/src/         React page. Talks to the notebook only via window.branchlog
  main.tsx                Mounts App
  App.tsx                 Shortcuts, menu actions, error boundary. Installs the AI trigger and settings shortcut
  temp-first-paint.ts     Startup probes. Still in the tree
  components/             One component per file. Daily canvas is DailyCanvas.tsx
                          Also EarlierSearch.tsx, ContinuationMark.tsx
                          AI: AiCommentNode.tsx, AiCommentBody.tsx, KeepHideText.tsx, AiThinkingDots.tsx,
                          AiResolvedMarks.tsx, AiStatusNote.tsx, AiSettings.tsx, BranchAi.tsx
  lib/                    Non-component helpers. AI: ai-trigger.ts, ai-trigger-install.ts, canvas-ai.ts,
                          keep-ranges.ts, keep-selection.ts, ai-settings-keys.ts
  store/                  useNotebook and the write queue. AI: ai-comments.ts, ai-settings.ts, ask-ai.ts
  styles/globals.css      Color tokens actually painted
  styles/theme-lab.css    Theme Lab panel
  styles/ai-comments.css  The left comment node
  styles/ai-chat.css      Selectable chat text, keep highlighting, the resolved dots
  styles/ask-ai.css       The right-side Ask AI control and its answer
  styles/ai-settings.css  The AI settings panel
src/shared/               Types and dates. No Electron, no React
  types.ts                Task, images, IPC shapes, type guards
  dates.ts                localDateKey, addDays, next local midnight
  clock.ts                The only now(). Test clock
  clock-off.ts            Production now()
  task-life.ts            open / done / dropped / carried / superseded. The page does not render it yet
  separate.ts             Rectangle separation. No React, no SQL
  theme.ts                Token list, default palettes, theme-row checks
  ai-comments.ts          AiComment shape, guards, kept-range helpers, the right-side answer types
  ai-settings.ts          AiSettings shape, defaults, parseBaseUrl, isPrivateAddress
tests/                    Playwright. launch.ts is the shared app launcher, mock-lm-studio.ts the fake LM Studio
scripts/rebuild-native.cjs
scripts/measure-first-paint.mjs
```

Renderer components: `DailyCanvas.tsx` (React Flow), `MainListNode.tsx`, `BranchNode.tsx`, `TaskBullet.tsx`, `ImageNode.tsx`, `DateHeader.tsx`, `TopBar.tsx`, `DeleteNotice.tsx`, `ThemeLab.tsx`, `ThemeLabTools.tsx`, `ThemeTokenList.tsx`, `AiCommentNode.tsx`, `AiCommentBody.tsx`, `KeepHideText.tsx`, `AiThinkingDots.tsx`, `AiResolvedMarks.tsx`, `AiStatusNote.tsx`, `AiSettings.tsx`, `BranchAi.tsx`.

Store: `notebook.ts` (open day, plus `continuations`), `history.ts` (undo, `recordCarry`), `carry-sync.ts`, `continuation.ts`, `images.ts`, `task-size.ts`, `preferences.ts`, `layout-commit.ts`, `layout-bridge.ts`, `delete-task.ts`, `delete-notice.ts`, `removed.ts`, `ai-comments.ts` (saved comments, answers, replies, kept ranges), `ai-settings.ts` (the settings row plus the panel), `ask-ai.ts` (the transient explicit request only). Styles: `continuation.css`.

| Cross-cutting thing | Where it lives |
|---|---|
| Focus a new field | `focusRequest` / `focusAt` on `useNotebook`. `useTaskFieldFocus` in `lib/field-focus.ts` applies it via `lib/focus-field.ts`. Creates set the request inside `createTask` / `createBranch`. |
| Create a task | Not one function. Main-list rows: `useNotebook.createTask` → `tasks.createSync`. Same-day branches: `useNotebook.createBranch` → `tasks.createBranchSync`. A new task from an earlier day: `store/continuation.ts` → `tasks:createContinuation`. Callers: `lib/task-keys.ts` (Enter), `lib/new-task.ts` (Ctrl/Cmd+N), `lib/branch-from.ts` (dot and Alt+Enter; an earlier day calls the continuation path). The renderer mints ids with `crypto.randomUUID()`. Carry copies are minted in `src/main/carry.ts`, not in the renderer. |
| Today's date | `now()` in `src/shared/clock.ts`, `localDateKey()` in `src/shared/dates.ts`. The header uses `lib/today.ts` (midnight, focus, wake on `clock:resume`). |
| Undo / redo | `src/renderer/src/store/history.ts`. Dropped when the day changes. Theme Lab undo is separate, in `lib/theme-engine.ts`. |
| Color tokens | Painted defaults in `styles/globals.css`. Saved theme and the token list in `src/shared/theme.ts`. Hex outside `globals.css`, `theme-lab.css`, and `theme.ts` fails `tests/theme-source.spec.ts`. |
| AI requests | Main owns every LM Studio call. `src/main/lm-studio.ts` is the only `fetch` in the app. `src/main/ai-flight.ts` holds one `auto` slot and one shared `user` slot, so a newer request aborts the older and a reused id cannot revive it. Prompts are in `ai-prompts.ts`, JSON parsing in `ai-parse.ts`. The page never fetches and never re-implements any of it. |
| AI text selection and Keep | `KeepHideText.tsx` with `lib/keep-ranges.ts` (merge, clamp, UTF-16 offsets) and `lib/keep-selection.ts` (offsets to a DOM range and back). Saved as `aiComments.keptRanges`; only the debounced write in `store/ai-comments.ts`. Nothing else the AI does may move focus or the caret. |

`nodeTypes` is a module-level constant in `DailyCanvas.tsx`. Node `data` is `{}`. Nodes read the task from the store.

Several files are already past the ~300-line guide: `notebook.ts`, `history.ts`, `globals.css`, `MainListNode.tsx`, `DailyCanvas.tsx`. Put new behavior in a new file.

## 4. Architecture

Renderer → `useNotebook` (or `useImages`) → `window.branchlog` (preload type-checks the reply) → `ipc.ts` → `validate.ts` → `database.ts` / `images.ts` / `task-tree.ts` → SQLite. The row comes back the same way. Creates wait for SQLite and show the row the database returned. Text, position, and branch size update the store immediately and write after 200ms. A failed text save is tried once more (800ms), then the store shows an error. Checking a box waits for IPC and rolls the store back on failure. Closing the window calls `flushPendingSync`.

Dragging does not write. `onNodeDrag` does not call `window.branchlog`. `onNodeDragStop` calls `updatePosition` once. Resize of a branch is the same: size is recorded on pointer-up, then the 200ms write in `task-size.ts`.

AI is the same shape with one addition: `window.branchlog.ai` → `ipc.ts` / `ai-request-ipc.ts` → `validate.ts` + `ai-validate.ts` → `ai-store.ts` / `ai-comment.ts` / `ai-ask.ts` → SQLite, and `lm-studio.ts` for the network. A comment or answer comes back on an async reply, so the page paints without waiting for the model. Nothing at boot touches the network: main does no AI work until the page asks, and the page asks only when `enabled` is on and typing has paused (`lib/ai-trigger.ts`, 12 characters minimum, `pauseDelayMs` default 2500, `maxCommentsPerDay` default 30 counted on `side = 'left'` only). The trigger comments on main-list rows only, and never on a done or let-go task. Closing the window flushes pending kept-range writes.

`branchlog.sqlite` is `app.getPath('userData')/branchlog.sqlite`. WAL, foreign keys on. Tests pass `--branchlog-profile` / `BRANCHLOG_USER_DATA` and must keep doing that.

| Table | Key columns | Used by the app |
|---|---|---|
| `tasks` | id, text, done, dateCreated, dateCompleted, parentId (cascade), x, y, width, height, side (`main` \| `right`), orderIndex, carriedFromId, chainId, droppedAt | Yes. `x`/`y`/`width`/`height` are the daily canvas. Main list ignores size. Unique `(chainId, dateCreated)`. `chainId` defaults to the row id via trigger `tasks_fill_chain`. |
| `images` | id, dateKey, fileName, x, y, width, height, cropLeft, cropTop, cropRight, cropBottom | Yes. File is `userData/images/<id>.png`. Crop columns are trimmed fractions; the file is never rewritten. |
| `settings` | key, value | Yes: `autoSeparate`, `swipeToPan`, `theme`, `autoCarry` (on unless the value is `0`), `highlightCarried` (on unless the value is `0`), `carryWindowDays` (default 14, else 0–3660). The TopBar menu switches `autoCarry` and `highlightCarried`; `carryWindowDays` still has no UI. `ai` holds one JSON row, the AI settings, owned by `src/main/ai-settings-store.ts`. |
| `mapPositions` | taskId, x, y | Table only. No map UI reads it. Delete/restore keeps the rows. |
| `aiComments` | id, taskId, side, type (`question` \| `remark` \| `correction`), text, status (`open` \| `resolved`), keptRanges, x, y, createdAt | Yes. `side` is `left` for the AI's own margin comment and `right` for an answer to an explicit ask. `src/main/ai-store.ts` owns every query; the per-day cap counts `left` only. `keptRanges` is a JSON array of UTF-16 `[start, end]` pairs, merged on write and clamped on read |
| `aiReplies` | id, commentId, role (`user` \| `ai`), text, keptRanges, createdAt | Yes. The chat thread under one comment. `keptRanges` trims a reply the same way a comment is trimmed |

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
- The AI never writes task text. No AI module touches `tasks.text`; comments, answers and replies live only in `aiComments` and `aiReplies`.
- A comment or answer arriving must never steal focus, move the caret, drop typed characters, or re-render the field being typed in. There is no `focus()` call anywhere in AI code.
- Only `src/main/lm-studio.ts` opens a socket. The renderer has no `fetch`. Do not add one and do not widen CSP for it.
- AI comments stay with the exact task copy they were made for and are never carried to a later day. Deleting a comment is undoable (`store/ai-comments.ts` + `ai:restoreComments`), as is deleting its task.
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
| Carry: the same unfinished task onto a later day | Done | `carry.ts`, `carry-schedule.ts`, `carry-sync.ts`. Automatic copy at startup, focus, resume, and midnight. Let-go is wired (`tasks:setDropped`, `LetGoAction.tsx`). Specs: `task-carry.spec.ts`, `task-carry-marks.spec.ts`, `task-let-go.spec.ts`, `task-carry-delete.spec.ts` |
| Concept Map | Not started | Menu item disabled (`CmdOrCtrl+M`). `mapPositions` is never drawn |
| **Phase 4. Activity calendar** | **Done** | `CalendarView.tsx` behind `view === 'calendar'` in `App.tsx`, the menu item (`show-calendar`) is enabled, and `tasks:activityCounts` in `ipc.ts` feeds it. `dateCompleted` is the local date when a box is checked. Spec: `tests/calendar.spec.ts`. Not covered here: the calendar on a database that also has carried and finished-later copies |
| **Phase 5. Images** | **Done** | |
| Paste anywhere on the canvas | Done | `lib/paste-image.ts`, `images.ts`, `ImageNode.tsx`. Accepts PNG/JPEG bitmaps, browser "copy image" (html alongside), and copied image files (via `text/uri-list`). A rejected paste shows an error. Longest edge capped at 480. `task-separate.spec.ts` ("a pasted image separates"), `image-paste.spec.ts` |
| Move | Done | Drag stop calls `useImages.move` |
| Drag and drop image files | Done | `lib/drop-image.ts`, `images:drop` channel (`dropImage` in `src/main/images.ts`), `tests/image-drop.spec.ts`. Bytes are read in the renderer and decoded in main like a paste. Non-image drops show an error |
| Resize | Done | `NodeResizer` in `ImageNode.tsx` (corners, aspect kept), `images:resize` channel, `resize` in `store/images.ts`, `tests/image-resize.spec.ts` |
| Crop | Done | Non-destructive. `cropLeft/cropTop/cropRight/cropBottom` fractions on the row (`migrate-images.ts`), `ImageCrop.tsx` edge-midpoint handles on a selected image (corner handles still resize), math in `lib/image-crop.ts`, saved through `images:resize`, undo via image history, `tests/image-crop.spec.ts`. The PNG file is never rewritten |
| Delete | Done | Backspace on a selected image (`ImageDeleteKeys.tsx`, reads React Flow selection) or the axe button on the selection (`ImageNode.tsx`), `useImages.remove` → `images:delete` (`deleteImages` in `src/main/images.ts`), row removed and PNG kept so undo restores it, `tests/image-delete.spec.ts` |
| **Phase 6. LM Studio margin comments** | **Done** | Stage 6, all five parts below. Everything stays off until `Enable margin comments` is ticked |
| Settings, client, mock server | Done | `AiSettings.tsx` opens with Ctrl/Cmd+comma and closes with Escape; `ai-settings-store.ts` owns the `settings.ai` row; `lm-studio.ts` is the only `fetch` (60s chat, 10s models, `AbortSignal.any`, `response_format` fallback). Specs: `ai-settings-parse.spec.ts`, `ai-settings.spec.ts`, `ai-client.spec.ts`. Tests talk to `tests/mock-lm-studio.ts`, never a real model |
| Automatic comments in the left margin | Done | `ai-comment.ts`, `ai-context.ts` (5 ancestors, 30 tasks, 2000 chars), `ai-prompts.ts`, `ai-parse.ts`, `lib/ai-trigger.ts`, `AiCommentNode.tsx`, `AiThinkingDots.tsx`, `AiStatusNote.tsx`. Per-day cap counts `side = 'left'`; an offline host leaves a calm note, not a dialog. Specs: `ai-comments.spec.ts`, `ai-comments-safety.spec.ts`, `ai-trigger.spec.ts`, `ai-context.spec.ts`, `ai-parse.spec.ts`, `ai-migration.spec.ts` |
| Keep and hide | Done | `KeepHideText.tsx` with `lib/keep-ranges.ts` and `lib/keep-selection.ts`; `keptRanges` is UTF-16 `[start, end]` JSON on the row, merged on write and clamped on read; the staged phrase uses the Custom Highlight API, the pin sits beside the axe, hover reveals the whole chat with kept phrases still marked. Specs: `ai-keep.spec.ts`, `ai-chat-interaction.spec.ts`, `ai-trim-presentation.spec.ts` |
| Ask AI in a right-side branch | Done | `BranchAi.tsx` (the Ask AI button), `ai-ask.ts`, `ai-request-ipc.ts`, `store/ask-ai.ts`, `ai-flight.ts` (one `auto` slot, one shared `user` slot; a newer ask aborts the older). Answers are `side = 'right'` and do not consume the left cap. Specs: `ai-ask.spec.ts`, `ai-ask-core.spec.ts`, `ai-ask-safety.spec.ts` |
| Hardening and evidence | Done | Every AI payload is validated (`validate.ts`, `ai-validate.ts`), all four system prompts demote notebook text to context, `applySchema` in `src/main/schema.ts` is the single boot order and reports per-step timings. `tests/ai-perf.spec.ts` measures the AI cost on this machine: `db-migrate-ai` 0.1–0.5 ms of a ~7–14 ms database init, a 500-comment left-only notebook widened in 8 ms (one time), a day with 200 tasks and 60 comments × 2 replies read in 1–1.4 ms in three queries, and the daily cap count in 0.2–0.4 ms on two indexes. Typing cost is asserted behaviorally, not in milliseconds (`ai-comments-safety.spec.ts`, `ai-ask-safety.spec.ts`) |
| **Phase 7. Packaging** | **Not started** | No installer script. Export and Import menu items are `enabled: false`. The first-paint script can assemble a Windows folder only |

Extras, outside the phases:

| Extra | Status | Evidence |
|---|---|---|
| Undo / redo | Done | `store/history.ts`, `tests/task-undo.spec.ts`, Edit menu. Theme undo is a second stack (`theme-lab-store.spec.ts`) |
| Hierarchy-aware copy and paste | Partial | Cross-task copy/cut joins main-list lines with newlines (`lib/list-edit.ts`, `task-clipboard.spec.ts`). A multi-line paste stays in one task (that spec asserts it). Nothing rebuilds a parent/child tree from the clipboard. Enter on a branch does create a sibling branch (`task-enter-focus.spec.ts`) |
| Theme Lab | Done | `ThemeLab.tsx`, `lib/theme-engine.ts`, `theme-store.ts`, `theme-lab.spec.ts`, `theme-lab-store.spec.ts`, `theme-lab-perf.spec.ts`, `theme-source.spec.ts`. Shortcut Ctrl/Cmd+Shift+T |
| Trackpad swipe-to-pan | Done | `lib/canvas-navigation.ts`, setting `swipeToPan`, `tests/canvas-pan.spec.ts`. Viewport is not saved |
| Startup performance work | Partial | `temp-first-paint.ts`, `src/shared/temp-timing.ts`, `scripts/measure-first-paint.mjs`, `first-paint-results/*.json`. Probes are still compiled in. `tempCountRender` increments a counter even when not measuring. No written report. The `db-*` step marks now come from `applySchema`, so `db-migrate-ai` appears in a fresh run without further wiring; `tests/ai-perf.spec.ts` prints the same steps without a window |
| Test suite | Done | Playwright only. See Testing. Carry and AI both have specs now |

**We are currently in Phase 3. The carry let-go state, its marks, and its settings are built; the next step is refusing a branch from a finished task, then the Concept Map.**

### Phase 3 rules in force

These are the decisions for the work underway. The code only partly matches them. Do not invent a second link type.

**Carry and branch stay different.** Carry is the same task continuing (`carriedFromId` + shared `chainId`). Branch is a new task (`parentId` across dates). On the Concept Map, draw the two links differently.

| Decision | What to build | What is there now |
|---|---|---|
| Carry is a copy, not a move. The source day keeps its row | Keep | `carryForward` inserts a new row. The source is not updated |
| Dropped is the escape. Struck through, and never carried again | Page control that calls `dropTask` / `undropTask` | Done. `tasks:setDropped` (`validate.ts` `parseTaskDrop`, `carry.ts` `dropTask` / `undropTask`), `LetGoAction.tsx`, strike-through in `task-states.css`, `tests/task-let-go.spec.ts`. Candidates skip `droppedAt` |
| Carry a task with its unfinished branches. Leave finished branches behind | Keep | A right-side child is copied beside its parent only when that parent is also copied. A finished row (`dateCompleted` set) is not a candidate. An unfinished branch whose parent is not copied becomes a main-list row and keeps the old `parentId` |
| Automatic carry, or ask each morning ("3 unfinished. Bring forward?") | A setting. Automatic is the simple default; asking is the calmer one | `autoCarry` defaults on and is a TopBar menu switch, live: turning it on runs a carry at once. No morning prompt. Window is `carryWindowDays`, default 14, no UI |
| Finishing the latest copy marks every earlier copy. Unchecking that latest copy reopens them all | One checkbox write updates the chain | `updateTask` writes only the row you clicked |
| An earlier copy finished this way looks different from a task finished on its own day: "finished later, on Nov 9", tooltip, click jumps to that day | Marker plus tooltip, not a new meaning piled onto color alone | Done. `data-state="finished-later"` row in `task-states.css`, double tick (`CheckCheck`) in `TaskBullet.tsx`, hover text "Finished Nov 9" plus the "Activate to open." wording in its accessible name, and the activation jumps. `--finished-later` is the color, the tick is the shape |
| The calendar counts only the day the work was actually completed | When Phase 4 is built, one `dateCompleted` lights one day | `dateCompleted` is the local date of that single checkbox write. Calendar UI is not started |
| No branch from a finished task | Refuse in `branch-from.ts`, `createContinuation`, and `EarlierSearch` | Not enforced. Search still lists done tasks, struck through, and a click still continues them |
| Carried tasks: a small marker and "carried N days" on hover. Age tint is optional and a setting. Do not add another required color (AI teal, done, finished-later, and carried is too many) | Marker like the continuation dot. Tint only if the setting is on | Done. `CarriedMark.tsx` (curved arrow, `--carried-strong`), hover "Carried from Nov 7 · day 3", row tint in three `color-mix` steps by days carried, capped at 3 (`data-tint`). `highlightCarried` switch removes the tint and the marker color only — the shape, the tooltips and the data stay |
| Concept Map: one node per chain, badge "N days", expand on click | New view. Do not grow `DailyCanvas.tsx` | Not started |
| Task state is one of: open, done, finished later, carried, dropped | Derive it. Do not store a second copy of the same fact | Stored facts are `dateCompleted`, `droppedAt`, `carriedFromId`, and "a later row shares `chainId`". `src/main/task-state.ts` derives them for the visible day in one query; `src/renderer/src/store/chain-states.ts` holds that map and `src/shared/task-life.ts` is the classifier carry uses. The page paints `data-state`, `data-carried` and `data-tint` from that map and stores nothing new |

Carry runs in the main process (`installCarrySchedule` from `index.ts`) and the page adopts the rows in `useCarrySync` / `recordCarry`. `tests/task-carry.spec.ts`, `task-carry-marks.spec.ts`, `task-let-go.spec.ts` and `task-carry-delete.spec.ts` now cover that path.

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
| Low | A kept-range write that fails is surfaced ("Could not save that kept text.") but not retried, unlike a task text save, which tries once more at 800ms | `writeKept` in `src/renderer/src/store/ai-comments.ts` |
| Low | The offline note stays until the next success or a settings change; nothing re-probes the host on a timer | `AiStatusNote.tsx`, `offline` in `store/ai-comments.ts` |
| Low | A blank model field costs an extra `/models` round trip on every request. That is how model switching stays live without a cache | `resolveModel` in `src/main/lm-studio.ts` |
| Low, unverified | In theory a kept range can split a UTF-16 surrogate pair, because validation bounds `end` by `text.length` only. No known browser selection produces it, and no test proves either way | `src/main/ai-validate.ts`, `src/renderer/src/lib/keep-ranges.ts` |

`COLOR_AUDIT.md` is a finished token pass, not an open bug list. `transparent`, `none`, and the system `Highlight` keywords were left on purpose. No `HEALTH_REPORT.md` or `TEST_COVERAGE.md`.

`first-paint-results/summary.json` is raw timings from a measurement machine. It is not a conclusion. Do not treat its seeded row counts as a user's notebook.

## 7. Testing

`playwright.config.ts`: `tests/`, one worker, not parallel, 60s test timeout, 10s expect. `npm test` builds, then runs every `*.spec.ts`.

`tests/launch.ts` starts the built app against a temp profile and is the shared launcher. `closeApp` kills the process. On Windows it also taskkills by pid and by the profile path.

The fake clock is compiled in, not read at run time: `electron.vite.config.ts:25` keeps `src/shared/clock.ts` only for `npm run dev`, for the lifecycle events `test` and `test:e2e`, or when `BRANCHLOG_ENABLE_TEST_CLOCK=1`. A bare `npx playwright test` uses whatever is in `out/`, so a plain `npm run build` — including one from another agent in this same checkout — silently strips the clock and every `BRANCHLOG_NOW` spec starts failing on real dates. For a scoped run, build it in: `BRANCHLOG_ENABLE_TEST_CLOCK=1 npx electron-vite build && npx playwright test tests/<spec>.ts`, and confirm with `grep -c branchlogNow out/main/index.js`.

No AI spec ever touches a real model. `tests/mock-lm-studio.ts` is a local HTTP server that speaks the LM Studio API and is what the app points its base URL at; `ai-helpers.ts`, `ai-chat-helpers.ts` and `ai-ask-helpers.ts` hold the shared enable/wait/mouse-selection helpers. The mock is started per test and closed with the app.

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
| `carry.spec.ts`, `task-carry.spec.ts` | The carry engine on its own (chain ids, dropped and finished rows skipped, delete relinks, `autoCarry` off, 5000 rows on the index) and the page receiving copies at midnight and after a restart |
| `carry-delete.spec.ts`, `task-carry-delete.spec.ts` | Deleting a finished parent keeps carried subtrees; deleting a middle copy removes only its same-day carried branches |
| `task-chain-state.spec.ts`, `task-chain-state-ui.spec.ts` | Derived chain states on the rows themselves (finished-later and dropped read backward without rewriting an earlier copy, a finished copy is not carried, one indexed per-day query inside its budget), and the page side: the read-only checkbox that navigates to the finishing copy and the calendar lighting the real completion day |
| `task-carry-marks.spec.ts` | Finished-later look (color from `--finished-later`, the double tick, the hover date), the carried marker with its day count, the three tint steps and the cap, `highlightCarried` off, and the same marks on branch nodes |
| `task-let-go.spec.ts` | Let-go hover persistence, its size and keyboard path, one undo step, the strike-through and the "Let go on" date, and no copy the next day. `autoCarry` off stops carrying and on brings the copies forward live |
| `task-separate.spec.ts` | Auto-separate for create, drop, resize, text growth, images; undo; setting off |
| `image-paste.spec.ts`, `image-drop.spec.ts`, `image-resize.spec.ts`, `image-crop.spec.ts`, `image-persist.spec.ts`, `image-migrate.spec.ts`, `image-delete.spec.ts` | Paste from clipboard flavors and copied files, file drop with its error, corner resize with undo and restart, crop of two sides with undo, redo, and restart, a dropped image surviving a close and reopen, an old database without the crop columns loading and cropping after the startup migration, and delete by Backspace or the axe button with undo, redo, the typing guard, and restart |
| `canvas-pan.spec.ts` | Swipe-to-pan, pinch zoom, setting survives restart |
| `theme-lab.spec.ts`, `theme-lab-store.spec.ts`, `theme-lab-perf.spec.ts` | Theme Lab edits, presets, import, undo, first frame, drag does not re-render nodes, and the four task-state tokens (`carried`, `carried-strong`, `finished-later`, `dropped`) listed and repainted live |
| `ai-settings-parse.spec.ts` | `parseBaseUrl`, `isPrivateAddress`, the defaults, the settings round-trip and every rejected field. No window |
| `ai-settings.spec.ts` | The panel, Ctrl/Cmd+comma and Escape, the enable switch, the "would be sent" warning on a non-private address, test connection, the model field, caps and bounds |
| `ai-client.spec.ts` | `lm-studio.ts` against the mock: `/models`, chat, timeouts, abort, the `response_format` fallback, malformed JSON |
| `ai-parse.spec.ts`, `ai-context.spec.ts` | Model JSON to text with length caps; the 5-ancestor, 30-task, 2000-character context budget |
| `ai-comments.spec.ts` | A comment for the right task at the right place, resolve and reopen, the per-day cap, comments survive a restart |
| `ai-comments-safety.spec.ts` | Typing through a slow answer keeps every character and comments only the final text; checking the task done while the model thinks produces no comment |
| `ai-trigger.spec.ts` | The pause, the 12-character minimum, main-list rows only, done and let-go rows skipped, the per-task sent set |
| `ai-keep.spec.ts` | Keep and un-keep, merged ranges, the 200ms debounced write, undo |
| `ai-chat-interaction.spec.ts` | Phrase selection by mouse and with Ctrl held, the pending highlight, the pin beside the axe, no scrollbar, the chat staying open while a reply is pending, blur clears a staged phrase |
| `ai-trim-presentation.spec.ts` | Keep leaves only the kept phrases visible, hover reveals the whole chat with the kept phrases still marked, and a resolved dot sits beside its own task |
| `ai-ask.spec.ts`, `ai-ask-core.spec.ts`, `ai-ask-safety.spec.ts` | The Ask AI button and its answer thread in a branch; the prompts (including the notebook-text-is-context guard), flight slots and parsing with no window; an answer arriving mid-typing preserves the field and the caret, cancel leaves no offline note, a newer ask wins |
| `ai-migration.spec.ts` | The old `side IN ('left')` database: rows, offsets, positions and indexes preserved, rollback on failure, and one boot order that reports every step |
| `ai-perf.spec.ts` | The measured AI cost, no window: `initDatabase` boot steps including `db-migrate-ai`, a 500-comment left-only notebook widened once inside budget, the day read with 200 tasks and 60 comments × 2 replies in three queries, and the daily cap count with its `EXPLAIN QUERY PLAN`. Numbers print to the log |
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

1. **Let a carried task go.** Landed. `dropTask` / `undropTask` are wired through `types.ts`, `preload/index.ts`, `validate.ts` (`parseTaskDrop`) and `ipc.ts` (`tasks:setDropped`); `LetGoAction.tsx` is the hover and keyboard control, the row is struck through in `--dropped` with a slashed-circle marker and a "Let go on {date}" hover, and one `Ctrl/Cmd+Z` undoes it. `tests/task-let-go.spec.ts` covers it, and a dropped task is not copied the next day.

2. **Finishing the latest copy closes the chain.** Landed, as a derivation rather than a write: `src/main/task-state.ts` answers the visible day's ids in one indexed query, and an earlier copy reads finished-later from the earliest `dateCompleted` on a later row. Earlier copies keep null completion fields, so the calendar still lights only the day actually finished. The look is `CheckCheck` in `--finished-later` with dimmed text, a read-only checkbox whose activation opens and focuses the finishing copy, plus "Finished {date}".

3. **Refuse a branch from a finished task.** `lib/branch-from.ts`, `createContinuation` in `continuation.ts`, and `EarlierSearch.tsx` (`choose` still runs for a struck-through done row). Cover it in `tests/task-continuation.spec.ts`.

After that: the Concept Map as one node per `chainId` with an "N days" badge. The carried-days marker is built (`CarriedMark.tsx`, "Carried from {date} · day N", tint only behind `highlightCarried`). Image resize (Phase 5) is done: corners with the aspect kept, saved through `images:resize`.

**Stage 6 (Phase 6, the LM Studio margin) is built and evidenced.** `tests/ai-perf.spec.ts` holds the startup and read numbers (section 5), so a run of `scripts/measure-first-paint.mjs` is only needed for the whole-window first-paint report, not for the AI. Typing cost is proven by behavior, not milliseconds, in `ai-comments-safety.spec.ts` and `ai-ask-safety.spec.ts`. The four AI limits in section 6 are the open list. Two rules for anyone continuing it: the only `fetch` in the app is `src/main/lm-studio.ts`, and no AI code may call `focus()` or write `tasks.text`.
