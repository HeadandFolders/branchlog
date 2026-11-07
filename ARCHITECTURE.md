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

Editing text, or dropping a branch in a new spot, updates the store right away. The write to SQLite waits a short moment and is sent once. Dragging does not write. The canvas holds the moving position until you let go, and only then does the store record it.

Checking a box or deleting a task updates the store, then waits for the database. If that write fails, the store puts the old value back and shows an error. A failed text save is tried once more, then the store shows an error.

Closing the window sends any waiting text and positions immediately.

Undo keeps a short history of the open day in the renderer. It is a list of earlier rows, not a second notebook. Changing the day drops that history. Undo and redo write the restored rows back through the bridge, including a full replace of that day's tasks when a task was created, deleted, moved, or checked.

## One owner for each fact

The database owns saved tasks. The store owns the open day. The write queue inside the store (`pendingText`, `pendingPosition`) only remembers what still needs to be saved. The canvas owns a position only while you are dragging it. Edges are drawn from `parentId` and are not stored. The caret and the "frame this page" callback are momentary and are not saved.

`x` and `y` on a task are the daily page. The database also has tables for AI comments, replies, images, concept-map positions, and settings. Nothing reads those yet. When those features are built, each table stays the owner of its rows, and concept-map positions stay in `mapPositions` rather than in the task's `x` and `y`.

## Where the code lives

- `src/main` — window, menu, security, backup, validation, IPC, and the database. `database.ts` opens SQLite and runs the day-to-day queries. `day-sync.ts` replaces one day's rows when undo needs the saved tasks to match the page again.
- `src/preload` — the bridge, and nothing else
- `src/renderer` — the React page, the store, and small helpers
- `src/shared` — types and date helpers used by the other three
- `tests` — Playwright tests that launch the real app against a temporary data folder
