# Editor audit

Read-only pass over the task editor. No app code was changed.

The editor is the `contenteditable="plaintext-only"` div in `TaskBullet` (`BulletText`). The main list adds cross-task selection in `MainListNode`. Branches use the same text field inside `BranchNode`. Text is stored on the task row through `useNotebook`. Evidence is the source, plus the cases already in `tests/task-editing.spec.ts`. Where a row says Works and no test is named, the app does not intercept that key or gesture, so Chromium's editing host handles it.

Statuses: **Works**, **Broken** (something runs, and the result is wrong), **Missing** (nothing implements it).

## Checklist

### Typing and deletion

| Behavior | Status | Note |
|---|---|---|
| Typing | Works | `onInput` writes the field's text into the store. Covered by `tests/task-editing.spec.ts`. |
| Typing over a selection | Works | The browser replaces the selection. Covered for Shift+arrow and for mouse drag, on a main-list task and on a branch. |
| Backspace, one character | Works | Native while the field has text. On an empty task, Backspace deletes the task instead. Both are covered by tests. |
| Delete, one character | Works | Delete is never handled, so the browser deletes forward. On an empty task it does not remove the task (Backspace does). |
| Ctrl/Cmd+Backspace deletes a word | Works | The empty-task delete ignores Ctrl, Cmd, and Alt, so a word delete is left to the browser. Windows and Linux: Ctrl+Backspace. macOS: Option+Backspace deletes a word; Cmd+Backspace deletes to the start of the line. |

### Undo and redo

| Behavior | Status | Note |
|---|---|---|
| Undo and redo of typing, while the caret is still in that task | Works | Ctrl/Cmd+Z, Ctrl+Y, and Shift+Ctrl/Cmd+Z hit Chromium's undo stack. The `input` event writes the undone text back through `updateText`. |
| Undo and redo of text after leaving the task | Broken | Leaving the task sets `contentEditable` to `false`, and Chromium drops that element's undo stack. There is no app-level history behind it. |
| Undo and redo of a paste | Broken | Paste assigns `textContent` in `insertPlainText`, which does not push a browser undo entry. |
| Undo and redo of structural actions | Missing | Delete task, new bullet, new branch, moving a branch, and check/uncheck update the store and SQLite directly. Nothing records a reverse step. |

### Selection

| Behavior | Status | Note |
|---|---|---|
| Select all within a task | Works | Ctrl/Cmd+A inside the field is ignored by the list-wide handler in `MainListNode` and selects that field. Covered by a test. Ctrl/Cmd+A with no caret in a field selects every main-list task, which is separate. |
| Double-click selects a word | Works | Nothing cancels `dblclick`. The field is editable after the first click, and the second click is the browser's word selection. |
| Triple-click selects the whole task text | Works | Nothing cancels the third click. In this field that selects the whole text node. |
| Shift+arrow extends the selection | Works | Covered by tests on the main list and on a branch. |
| Home and End | Works | Nothing handles those keys. The browser moves to the start or end of the line. |
| Ctrl/Cmd+arrow for word and line movement | Works | Nothing handles those keys. Windows and Linux: Ctrl+arrow moves by word. macOS: Cmd+arrow moves to the line edge, Option+arrow moves by word. |

### Mouse selection

| Behavior | Status | Note |
|---|---|---|
| Drag to select text | Works | Single-task drag is the browser selection. A drag that crosses main-list tasks is the custom range in `MainListNode`. Covered for a branch, including when the branch node is selected. |
| No accidental node drag while selecting text | Works | The text field has `nodrag` and `nopan`. The main list node is not draggable. Covered for a branch. |

### Clipboard

| Behavior | Status | Note |
|---|---|---|
| Copy | Works | Inside one task this is the browser. A selection that spans main-list tasks is joined with newlines by the `copy` handler in `MainListNode`. |
| Cut inside one task | Works | The browser cuts plain text and `onInput` saves the remainder. |
| Cut across tasks | Missing | A cross-task selection turns `contentEditable` off, and there is no `cut` handler. Backspace and Delete remove the text without placing it on the clipboard. |
| Paste as plain text | Works | Paste reads `text/plain`, or the text of `text/html` when the plain part is empty, and inserts that string. Markup is not inserted. Covered by a test. |
| Paste of multi-line text | Missing | Newlines are inserted into the same task (`white-space: pre-wrap`). Nothing splits lines into bullets. |

### List editing

| Behavior | Status | Note |
|---|---|---|
| Up and Down move between main-list bullets | Missing | Arrow Up and Arrow Down are left to the browser, so they only move inside the current task's wrapped or broken lines. `focusedId` never changes. |
| Enter creates a new bullet | Works | Enter calls `splitAtCaret`: the text after the caret becomes a new main-list task, or a new branch when the current task is a branch. |
| Shift+Enter inserts a line break | Works | Shift+Enter produces `insertLineBreak`, and `onBeforeInput` returns without cancelling it. The field is `pre-wrap`, so the break stays inside the task. |

### Context menu and spelling

| Behavior | Status | Note |
|---|---|---|
| Right-click menu: Cut, Copy, Paste, Select All | Missing | The main process never listens for `context-menu`. Electron draws no edit menu on right-click. The application menu has no Edit submenu either, so on macOS the standard Cmd+Z / X / C / V / A menu shortcuts do not reach the page. |
| Spellcheck underlines | Works | Electron's built-in checker is left on (no `spellcheck: false` in `webPreferences`). The field sets `spellCheck` while it is the one being edited. |
| Spellcheck suggestions | Missing | Suggestions are only delivered through the context menu (`dictionarySuggestions`). That menu does not exist. |

### Text that is not plain English

| Behavior | Status | Note |
|---|---|---|
| Long text wraps | Works | `.bullet-text` is `white-space: pre-wrap` and `overflow-wrap: anywhere`. The main list is a fixed column; a branch is capped at 320px. |
| Emoji | Works | The field stores JavaScript strings, and caret offsets use the same UTF-16 indexes as those strings. No path strips non-ASCII. |
| Right-to-left text | Broken | The field never sets `dir`. The page base direction stays left-to-right, so an Arabic or Hebrew paragraph stays left-aligned and edge caret movement follows that base direction. |
| IME composition | Works | Key handling returns immediately while `isComposing` or `key === 'Process'`. Paste does the same. Composition itself is Chromium's. |

### Focus and saving

| Behavior | Status | Note |
|---|---|---|
| Click places the caret where you clicked | Works | Main list and branch both store the click point and restore it with `caretRangeFromPoint` when the field focuses. A click that already has a selection keeps that selection. |
| Escape leaves the text field | Missing | Escape is only handled while the top-bar menu is open, and that handler does not blur the task. |
| Autosave if the app closes mid-typing | Works | Each keystroke is stored in `pendingText` immediately. `beforeunload` calls `flushPendingSync`, which writes those rows with synchronous IPC before the window goes away. |

### Accessibility

| Behavior | Status | Note |
|---|---|---|
| Labels | Works | The text field is `role="textbox"` with `aria-label="Task"`. The checkbox, branch dot, delete button, and empty-page field have their own names. |
| Focus rings for keyboard users | Broken | `.bullet-text` sets `outline: none` and has no `:focus-visible` ring. `button:focus-visible` also clears the outline, and the branch dot only raises its opacity. A task is `contentEditable="false"` until it is clicked, so it is not in the tab order and a keyboard user cannot move into it. `aria-multiline` is `false` even though Shift+Enter inserts a break. |

## Decisions for the gaps

These are the behaviors to build after you say go. Resting visuals stay as they are.

- **Multi-line paste.** Split on line breaks. The first line replaces the selection in the current task. Each later line becomes a new bullet after it (a sibling branch if the current task is a branch). A final trailing newline does not add an extra empty bullet. Blank lines in the middle do.
- **Up and Down.** Only in the main list. Inside a task they keep moving between visual lines. From the first line, Up focuses the previous bullet. From the last line, Down focuses the next one. The caret keeps its column when the destination line is long enough, otherwise it goes to the end.
- **Escape.** Blur the field and clear `focusedId`. Do not delete the task.
- **Undo and redo.** One history for the open day, dropped when the day changes. A burst of typing is a single step. Delete, new bullet, new branch, moving a branch, and check/uncheck are each one step. Ctrl/Cmd+Z undoes. Shift+Ctrl/Cmd+Z and Ctrl+Y redo. Each step writes through the same store and database paths as the original action.
- **Context menu.** Right-click on a task offers Cut, Copy, Paste, and Select All, plus spelling suggestions when the checker has any. The same Edit roles go on the application menu so macOS shortcuts reach the page.
- **Right-to-left.** Set `dir="auto"` on the text field so the paragraph direction follows the text.
- **Keyboard access.** A task can be reached with Tab, shows a `:focus-visible` ring, and reports `aria-multiline="true"`. The ring is the only new paint, and it appears on keyboard focus.

## Proposed commits, after you say go

1. Caret movement: Up/Down between main-list bullets, and Escape leaves the field.
2. Multi-line paste, including cut of a selection that spans tasks.
3. Context menu, spellcheck suggestions, and Edit menu roles.
4. Undo and redo for text and for structural actions.
5. `dir="auto"`.
6. Tab reachability, focus rings, and `aria-multiline`.

Each commit gets Playwright coverage for the behavior it adds. Rows marked Works stay as they are.
