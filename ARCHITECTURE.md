# Architecture

How a task moves through Branchlog. When this flow changes, update this file.

The window and the database are two processes. They never touch each other. A small bridge sits between them.

## What you see

The window is a React page (the renderer). The open day lives in one store, `useNotebook`. The page reads tasks, the date, focus, and errors from that store.

The daily page is one canvas. The main list is a single node. Each branch is its own node, tied to its parent by `parentId`. Those nodes are a view of the store. They do not keep their own copy of the task. A branch node looks up its task in the store by id.

## What is saved

The Electron main process owns a SQLite file, `branchlog.sqlite`, in the app's user-data folder. It is the record of every task. The renderer cannot open that file. On startup the main process copies it into `backups/` once per day and keeps the last seven copies. Window size and position are a separate file, `window-state.json`, next to the database.

## How a change moves

The preload script is the only bridge. It puts `window.branchlog` on the page. The page calls that. Preload forwards the call to the main process, which checks the payload and then reads or writes SQLite. The result comes back the same way.

Opening a day flushes any text or position still waiting, then loads that day's rows and replaces the store's list. If you have already moved to another day by the time the rows arrive, those rows are discarded.

Creating a task or a branch waits for the database. The store shows the row the database returned, so the page cannot show a task that was rejected. The page creates the id.

Branching from an earlier day writes a new main-list task onto today and leaves the earlier task unchanged. The new task keeps that earlier task as its parent. The daily page does not draw an arrow for that link. It shows a dot to the left of the checkbox. The dot's words are the parent row's text and date, read when the day opens and held on the store for that day only. They are not written back. The Go menu item "Branch from an earlier task", and Ctrl or Cmd+K, search tasks dated before today and use the same write. A branch from a task on today, or on a later day, still grows to the right on that day's page.

Editing text, or dropping a branch in a new spot, updates the store right away. The write to SQLite waits a short moment and is sent once. Dragging does not write. The canvas holds the moving position until you let go, and only then does the store record it. Resizing a branch works the same way: the new width, height, and position are recorded when you let go, and that write waits the same short moment.

When auto-separate is on, a create, a drop, a resize, a text reflow, or a pasted image can glide overlapping branch and image rectangles apart. Main-list rows stay where they are. The glide is drawn on the canvas only. When it stops, one layout commit writes every moved position. That commit is part of the history entry for the action that caused it, so one undo restores the action and the positions together. The setting lives in `settings` under `autoSeparate` and is on when that row is missing. Trackpad scrolling lives in `settings` under `swipeToPan` and is on when that row is missing. On, a wheel or a two-finger swipe pans the daily canvas, and a pinch or Ctrl (Windows and Linux) or Cmd (macOS) held while scrolling zooms it. Off, the wheel zooms, which is the older behavior. Panning and zooming change the viewport on screen only. They do not write to SQLite. The canvas recenters when the day loads. Pasted images are rows in `images`, and the file is `userData/images/<id>.png`.

The open theme lives in `settings` under `theme`. It is one JSON document: the light palette, the dark palette, whether to follow the system, the chosen mode, and named presets. The preload reads that row once, synchronously, and writes a style tag before the first paint. Later edits change those CSS variables on the document. They are not React state. The write back to `settings` waits a short moment, the same way task text does. Theme Lab's own undo stack is separate from task undo.

Checking a box updates the store, then waits for the database. If that write fails, the store puts the old value back and shows an error. A failed text save is tried once more, then the store shows an error.

Closing the window sends any waiting text and positions immediately.

Undo keeps a short history of the open day in the renderer. It is a list of earlier rows, not a second notebook. Changing the day drops that history. Undo and redo write the restored rows back through the bridge, including a full replace of that day's tasks when a task was created, deleted, moved, or checked.

Deleting a task removes that task and every descendant, on every day, in one database transaction. AI comments, replies, and concept-map positions are removed with those tasks by foreign keys. Edges are drawn from `parentId` and disappear with the tasks. Images are not attached to a task, so a delete does not remove them. The undo entry keeps the removed tasks, including ones from other days, and their concept-map positions. Undo writes that set back. For about eight seconds the page shows "Deleted N tasks. Undo", and that button uses the same undo as Cmd/Ctrl+Z.

## One owner for each fact

The database owns saved tasks. A task's `dateCreated` and `dateCompleted` are local calendar keys (`YYYY-MM-DD`), the same shape as the open day. The store owns the open day. A continuation's parent text and date belong to the parent task. The store keeps a copy of those two fields for the open day so the dot can name them, and the next day load replaces that copy. The write queue (`pendingText`, `pendingPosition`, and the branch size queue) only remembers what still needs to be saved. Today's key is not stored: `now()` and `localDateKey()` in `src/shared/dates.ts` compute it from the local year, month, and day. The page title reads that key again at the next local midnight, when the window focuses, and when the computer wakes. The main process tells the page about a wake on `clock:resume`. Moving between days uses `addDays`, which steps the calendar date. The canvas owns a position only while you are dragging it, and a branch's size only while you are resizing it. Edges are drawn from `parentId` and are not stored. The caret and the "frame this page" callback are momentary and are not saved.

`x` and `y` on a task are its place on the daily page. `width` and `height` are the branch node's size there. A height of 0 means the branch is as tall as its text. The main list ignores both. The database also has tables for AI comments, replies, images, concept-map positions, and settings. The daily page reads `images` and the `autoSeparate` setting. AI comments, replies, and concept-map positions are still unread. Each table stays the owner of its rows, and concept-map positions stay in `mapPositions` rather than in the task's `x` and `y`.

## Where the code lives

- `src/main` — window, menu, security, backup, validation, IPC, and the database. `database.ts` opens SQLite and runs the day-to-day queries. `continuation.ts` writes a task onto today from an earlier parent, lists those parent links for a day, and searches tasks dated before today. `day-sync.ts` replaces one day's rows when undo needs the saved tasks to match the page again. `task-tree.ts` deletes a task with its descendants and restores that set. `migrate.ts` rebuilds an older tasks table so a parent delete cascades, adds `width` and `height` when those columns are missing, then once removes tasks whose parent row is already gone. `images.ts` stores a pasted image and lists the day's images. `layout-save.ts` writes the positions from one settled separation. `settings.ts` reads and writes `autoSeparate` and `swipeToPan`. `theme-store.ts` reads and writes the `theme` settings row. `src/shared/theme.ts` is the token list, the default palettes, and the checks on that row.
- `src/shared/separate.ts` — the rectangle separation used by the daily canvas. It does not touch React or the database.
- `src/preload` — the bridge, and nothing else
- `src/renderer` — the React page, the store, and small helpers
- `src/shared` — types and date helpers used by the other three. `dates.ts` owns today's key, and `clock.ts` is the only `now()`. A development build, and the build `npm test` produces, read `BRANCHLOG_NOW` there. A production build replaces that file with `clock-off.ts`, which always uses the real time.
- `tests` — Playwright tests that launch the real app against a temporary data folder
