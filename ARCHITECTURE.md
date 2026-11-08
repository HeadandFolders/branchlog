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

Editing text, or dropping a branch in a new spot, updates the store right away. The write to SQLite waits a short moment and is sent once. Dragging does not write. The canvas holds the moving position until you let go, and only then does the store record it. Resizing a branch works the same way: the new width, height, and position are recorded when you let go, and that write waits the same short moment.

Checking a box updates the store, then waits for the database. If that write fails, the store puts the old value back and shows an error. A failed text save is tried once more, then the store shows an error.

Closing the window sends any waiting text and positions immediately.

Undo keeps a short history of the open day in the renderer. It is a list of earlier rows, not a second notebook. Changing the day drops that history. Undo and redo write the restored rows back through the bridge, including a full replace of that day's tasks when a task was created, deleted, moved, or checked.

Deleting a task removes that task and every descendant, on every day, in one database transaction. AI comments, replies, and concept-map positions are removed with those tasks by foreign keys. Edges are drawn from `parentId` and disappear with the tasks. Images are not attached to a task, so a delete does not remove them. The undo entry keeps the removed tasks, including ones from other days, and their concept-map positions. Undo writes that set back. For about eight seconds the page shows "Deleted N tasks. Undo", and that button uses the same undo as Cmd/Ctrl+Z.

## One owner for each fact

The database owns saved tasks. The store owns the open day. The write queue (`pendingText`, `pendingPosition`, and the branch size queue) only remembers what still needs to be saved. The canvas owns a position only while you are dragging it, and a branch's size only while you are resizing it. Edges are drawn from `parentId` and are not stored. The caret and the "frame this page" callback are momentary and are not saved.

`x` and `y` on a task are its place on the daily page. `width` and `height` are the branch node's size there. A height of 0 means the branch is as tall as its text. The main list ignores both. The database also has tables for AI comments, replies, images, concept-map positions, and settings. Nothing reads those yet. When those features are built, each table stays the owner of its rows, and concept-map positions stay in `mapPositions` rather than in the task's `x` and `y`.

## Where the code lives

- `src/main` — window, menu, security, backup, validation, IPC, and the database. `database.ts` opens SQLite and runs the day-to-day queries. `day-sync.ts` replaces one day's rows when undo needs the saved tasks to match the page again. `task-tree.ts` deletes a task with its descendants and restores that set. `migrate.ts` rebuilds an older tasks table so a parent delete cascades, adds `width` and `height` when those columns are missing, then once removes tasks whose parent row is already gone.
- `src/preload` — the bridge, and nothing else
- `src/renderer` — the React page, the store, and small helpers
- `src/shared` — types and date helpers used by the other three
- `tests` — Playwright tests that launch the real app against a temporary data folder
