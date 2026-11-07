# Branchlog

### Your days, your tasks, and the thread that connects them.

## The pitch

Most to-do apps treat every day as a blank slate. But real work doesn't happen that way. Yesterday's small fix becomes today's side project, and last week's idea becomes this week's main task.

**Branchlog is a daily task notebook that remembers where every task came from.** Write your tasks, check them off, and branch any of them into new work. Branchlog draws the whole story as a concept map you can zoom around, so you can see how you got from A to Z.

## Core features

### 1. A daily notebook with checkboxes

Each day has its own page. Write the tasks you're handling as simple checkbox bullets, with no setup and no project boards. Open the app, type, and check things off.

### 2. The branch dot

Every bullet ends with a small dot. Click it to start a new branch from that task.

- **Same day:** the branch grows to the right on an infinite canvas, so related thoughts sit side by side instead of piling into a long list.
- **From an earlier day:** click the dot on an old task and the new task is written into *today's* page, with a branch dot next to its bullet. That marks it as a continuation. Nothing from the past gets rewritten, and the link to its parent is kept.
- **Left and right:** the left of the main list is where the AI starts things: comments, questions and branches. The right is yours: you start branches there, and can optionally pull the AI in, for example by asking it a question.
- **Drag and connect:** every branch, whether the AI starts it on the left or you start it on the right, can be dragged anywhere on the canvas. An arrow always connects it to its parent and follows as you move it.

### 3. The Concept Map

Switch to the map view and see every task and every branch on an infinite canvas. Pan, zoom, and follow the lines from any task back to its origin or forward to everything it grew into.

- Branches show visually how work flowed from one day to another
- Completed and open tasks look different at a glance
- Click any node to jump to its day

### 4. The Activity Calendar

A GitHub-style contribution grid of your year. A day lights up as **active** whenever at least one task was checked off that day. No streak pressure, just a clear picture of the days you showed up.

### 5. Local AI Mode with LM Studio (optional)

Connect Branchlog to LM Studio and a model running on your own machine acts as a margin companion. As you write, comments appear **on the left of what you wrote**, and they can:

- **Ask questions** when a task is vague ("What does done look like for this?")
- **Remark** on what you wrote when it's useful
- **Correct** mistakes or unclear wording

You can reply to a comment, resolve it, or dismiss it. The AI speaks only when it has something worth saying, and it never edits your text. Nothing leaves your computer, and there are no API keys or per-use costs, because Branchlog talks to LM Studio's local server.

### 6. Images, anywhere on the canvas

Paste an image straight from your clipboard and it lands on the canvas where you want it. It doesn't need a dot or a task, so an image can stand on its own.

- **Paste anywhere:** copy an image, click a spot on the canvas, and paste
- **Resize freely:** drag a corner to make it bigger or smaller

### 7. You decide what the AI leaves on screen

AI answers never have to clutter your page. You choose what stays visible.

- **Delete anything:** remove any AI comment or answer for good, so it doesn't stay stuck on the screen
- **Keep only the good parts:** select a word, phrase or sentence in an answer and keep it. The rest is hidden from view
- **Hover to see it all:** hover over a trimmed answer to read the full text
- **Always distinct:** everything the AI writes has its own color, so you can tell its words from yours at a glance

### 8. A real desktop app

Branchlog is a desktop app, not a website. You install it, open it from your dock or taskbar, and it works fully offline.

- **Your data stays on your computer:** tasks, branches and pasted images are saved in a local file, with a daily automatic backup
- **Talks to LM Studio directly:** the AI features need no browser setup, only LM Studio's local server running
- **Feels native:** a system menu, keyboard shortcuts, and a window that remembers its size and position
- **Export and import:** move your notebook to another computer with one file
- **Windows, macOS and Linux:** one installer for each

## How it works

1. **Write** today's tasks as checkboxes.
2. **Check** them off as you finish. The calendar lights up.
3. **Branch** from any task with its dot, today or from weeks ago.
4. **Zoom out** to the Concept Map and see the path you took.

## Who it's for

- Developers and designers juggling many small tasks that spawn other tasks
- Students and researchers whose projects evolve over weeks
- Anyone who wants a record of how their work actually unfolded

## Why it's different

| Typical to-do app | Branchlog |
|---|---|
| Tasks are isolated | Tasks have parents and children |
| Old tasks get archived and forgotten | Old tasks can be branched into today |
| Progress is a percentage bar | Progress is a year-long activity calendar |
| AI is a separate chat window | AI comments sit in the margin, next to your words |

## Suggested data model (for building)

- **Task:** `id`, `text`, `done`, `date_created`, `date_completed`, `parent_id` (nullable), plus `x` and `y` for its spot on the canvas
- **Branch link:** a task with a `parent_id` is a branch. If the parent's date differs from today's, show the branch dot beside its bullet.
- **Calendar:** a day is active if any task has `date_completed` on that day.
- **AI comments:** `id`, `task_id`, `text`, `status` (open, resolved, dismissed), plus `kept_ranges` (the parts you chose to leave visible)
- **Image:** `id`, `src`, `x`, `y`, `width`, `height` (positioned on the canvas, no `parent_id` needed)
