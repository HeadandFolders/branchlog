# Branchlog: Design Guide

Derived from two reference screenshots of a calm journaling app: a "Journal" page with one AI question on the left, and a "YouTube Ideas" page with several AI comments on the left and one on the right. Values are close approximations read from the screenshots, so treat them as a starting point and tune by eye.

**Feeling:** quiet, paper-like, unhurried. The page is a sheet of off-white paper. The user's words are the main thing. The AI is a soft voice in the margin, never a chat window.

---

## 1. Principles

1. **Paper first.** Almost no chrome. No heavy borders, no shadows, no filled buttons. Structure comes from whitespace and alignment.
2. **Two voices, two typefaces.** The user writes in a clean sans-serif. The AI speaks in a serif and its own color. You can tell who said what without reading a label.
3. **The margin is the AI's home.** AI comments live to the left of the main list. Things the user starts live to the right.
4. **Low contrast for controls, high contrast for content.** Buttons and metadata whisper (light gray). Text you read is near-black.
5. **Everything is dismissible.** Nothing the AI says is permanent. Delete, resolve, trim.

---

## 2. Color

| Token | Value (approx.) | Use |
|---|---|---|
| `--bg` | `#F3F3EF` | Page background, a warm off-white with a slight gray cast |
| `--bg-subtle` | `#ECECE7` | Hover states, selected bullet highlight |
| `--text` | `#1A1A1A` | User text, page title |
| `--text-muted` | `#8A8A85` | Toolbar labels, "2 replies", Resolve / Dismiss, placeholders |
| `--text-faint` | `#B8B8B2` | Disabled controls, ghost icons |
| `--line` | `#D9D9D3` | Thin rules, connector lines, input underline |
| `--ai` | `#2F6F6A` (muted teal) | ALL AI text: comments, replies, answers |
| `--ai-soft` | `#E4EFEE` | AI highlight and kept-selection background |
| `--ai-line` | `#9CC2BE` | Arrows from AI comments to their bullet |
| `--accent-dot` | `#1A1A1A` | The branch dot |
| `--active-0` | `#E6E6E0` | Calendar: inactive day |
| `--active-1` | `#2F6F6A` | Calendar: active day |

**Deliberate change from the reference:** in the screenshots the AI text is dark, like the user's. Branchlog gives all AI text its own color (`--ai`) so it is never confused with user text. Keep it muted, never saturated.

Dark mode (optional, later): invert to `--bg #161614`, `--text #EDEDE8`, lift `--ai` to `#7FBFB8`.

---

## 3. Typography

| Role | Family | Size / weight | Notes |
|---|---|---|---|
| Page title ("Journal", "YouTube Ideas") | Sans: Inter or Geist | 32 to 36px, 600 | Tight tracking (-0.02em). Left-aligned with the main list |
| User text (bullets, notes) | Sans: Inter or Geist | 15 to 16px, 400 | Line height 1.6 |
| AI comments and answers | Serif: Newsreader, Source Serif 4, or Lora | 15px, 400 | Line height 1.55. Always `--ai` color |
| Toolbar and metadata | Sans | 12 to 13px, 400 | `--text-muted` |
| "N replies" | Sans | 11 to 12px | `--text-muted` |
| Wordmark ("riddled." style) | Serif | 14px, 600 | Top-left, next to a small solid dot |
| Shortcut note (top-left) | Handwriting: Caveat, Segoe Print fallback | 16px, 500 / 600 | The one exception below |

Rules:
- Two families carry the page: one sans for the user, one serif for the AI. The third, a handwriting face (`--font-hand`), is only for the scratchpad shortcut note in the top-left. Never use it for content.
- Never bold AI text. Emphasis comes from kept-selection highlighting (see section 7).
- Numbered lists in user text use plain numerals, no custom bullets.

---

## 4. Layout

**Overall:** a thin top bar, then one large canvas. No side panels competing with the page.

```
[ top bar: menu icon · wordmark                           ]
[                                                         ]
[  AI margin  |  ● Title            | user branches →     ]
[  (left)     |    main list       |  (right)            ]
```

- **Top bar:** about 40px tall. A hamburger icon and the wordmark on the left. Nothing else is required.
- **Title row:** the page title, with a row of tiny muted actions above it (see the toolbar below).
- **Main list column:** about 520 to 600px wide, centered. This is the anchor of the canvas.
- **Left margin:** AI comments. Their text is right-aligned in the second screenshot, so the text hugs the main list. Column width about 220 to 260px.
- **Right of the list:** user-started branches, growing outward on the infinite canvas.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48. Generous vertical rhythm, 8 to 12px between bullets.

### Toolbar above the title
Small muted items in one row, each an icon plus a label, no borders:
`Calendar` · `Concept Map` · `AI: On` (dropdown) · `Share`

Hover turns them to `--text`. No filled states.

---

## 5. Components

### Bullet (task)
- Plain text line with a checkbox to its left.
- Checkbox: 16px, 1.5px `--line` border, square with a 3px radius. Checked fill is `--text` with a white tick. Done text gets a `--text-muted` color and a thin strikethrough.
- **Branch dot** at the end of the line: a 6px solid circle in `--accent-dot`, 60% opacity at rest, 100% on hover, with a 12px click target. Echoes the small dots in the screenshot margins.
- **Cross-day branch marker:** a small dot (same style) to the left of the checkbox, with a tooltip showing the parent text and date.
- Selected or focused bullet: subtle `--bg-subtle` background, no outline.

### AI comment (left margin)
- Text in the serif at `--ai` color, right-aligned in the margin (matches screenshot two).
- No card, no border, no background at rest. It reads as handwriting in the margin.
- A small dot sits between the comment and the main list (this is where the arrow attaches).
- Below the text, in muted 11 to 12px: `2 replies`, `Resolve`, `Delete` (replaces the screenshot's "Dismiss").
- Open comment, as in screenshot one: the comment text, then a "Write back..." input with a single 1px `--line` underline (no box), a small paper-plane send icon on the right, then the `Resolve` and `Delete` links and an overflow `...` menu.

### Connector arrow
- 1px line, with a small arrowhead at the parent end.
- AI arrows: `--ai-line`. User branch arrows: `--line`, slightly darker on hover.
- Curved (smooth step or bezier), never sharp-cornered.
- Arrows follow nodes as they are dragged.

### Branch node (right side)
- Small checkbox bullet, same typography as the main list.
- Draggable anywhere. On hover a faint `--bg-subtle` pill appears behind it.
- An optional "Ask AI" action shows only on hover, as muted text. The AI's answer appears inside the node as a serif `--ai` block.

### Image node
- No frame by default. 2px radius.
- On select: a 1px `--ai` outline with small square resize handles at the corners (aspect ratio locked).

### Buttons and inputs
- No filled buttons. Text links in `--text-muted`, turning to `--text` on hover.
- Inputs: underline only (1px `--line`), turning `--text` on focus. Placeholder in `--text-muted`.
- Primary actions, when needed (for example "Test connection"), use a 1px outline button with a 6px radius.

---

## 6. Concept Map view

- Same `--bg` canvas with a very faint dot grid (`--line` at 40% opacity, 24px spacing).
- Nodes are small, borderless pills: text in the sans, date in muted 11px beneath.
- Open tasks: `--text`. Done tasks: `--text-muted` with a small filled dot on the left.
- Edges: 1px `--line` with arrowheads. Cross-day edges are slightly longer and curved, which makes day-to-day flow readable at a glance.
- Minimap in the bottom-right corner at 60% opacity, zoom controls bottom-left, both with no borders.
- Dates act as soft column labels in muted text across the top.

---

## 7. AI trimming: keep, hide, hover

This is the signature interaction.

- **Select** a word, phrase or sentence in an AI comment. A tiny floating `Keep` label appears just above the selection (muted text on `--bg`, 12px, no box).
- **Kept text** gets a `--ai-soft` background and stays visible. The rest of the comment is hidden. Between non-adjacent kept ranges show a muted ellipsis (`…`).
- **Hover** over a trimmed comment: the full text fades in (150ms) and the kept ranges remain highlighted. Moving away collapses it again.
- **Delete** removes the whole comment and its arrow immediately, with a short fade (120ms).
- If nothing is kept, the full comment shows at rest.

---

## 8. Calendar view (activity grid)

- A GitHub-style grid: 12px squares, 3px gap, 2px radius, 53 columns by 7 rows. Month labels above, `Mon / Wed / Fri` labels on the left, both in muted 11px.
- Inactive: `--active-0`. Active: `--active-1`. Optional intensity steps (3 tints of teal) if you later want to show how many tasks were done.
- Tooltip on hover: `Nov 6, 2026 · 3 tasks completed`, small, no shadow, `--bg` with a 1px `--line` border.
- No streak counters, no flames, no pressure UI.

---

## 9. Motion

- Durations: 120 to 200ms. Easing: `cubic-bezier(0.2, 0, 0, 1)`.
- Hover reveals fade in. Nothing bounces or slides far.
- Nodes follow the cursor 1:1 while dragging, with no easing.
- Respect `prefers-reduced-motion`: disable fades and use instant state changes.

---

## 10. Iconography

- Thin line icons, 16px, 1.5px stroke, `--text-muted`. Lucide fits well.
- Use icons sparingly: menu, calendar, map, send, more (`...`), delete, image.
- The only filled shapes in the interface are the dots (branch dot, wordmark dot, active calendar days).

---

## 11. Do and don't

| Do | Don't |
|---|---|
| Use whitespace to separate things | Use cards, borders or shadows |
| Keep AI text teal and serif | Mix AI text into the user's color or font |
| Keep controls muted until hover | Add filled, colorful buttons |
| Let arrows do the connecting | Add labels or numbers to every connection |
| Keep the left margin for AI and the right for the user | Mix them |

---

## 12. Desktop app

Branchlog is a desktop app (Electron), not a website. The look above stays the same. These rules cover what is different on the desktop.

- **Window:** opens at about 1280 x 800 with a minimum of 900 x 600. Remembers its size and position between launches.
- **Title bar:** start with the native title bar. A custom, frameless bar is optional later. If you build one, it uses `--bg` so the window reads as one sheet of paper, with the menu icon and wordmark on the left and the platform's window buttons on their usual side.
- **Native menu:** use the system menu bar for app-level actions (Today, Previous day, Next day, Concept Map, Calendar, Settings, Export / Import). The in-app toolbar keeps only the quiet view switchers.
- **Shortcuts:** Cmd/Ctrl+T Today, Cmd/Ctrl+M Concept Map, Cmd/Ctrl+K search earlier tasks, Cmd/Ctrl+, Settings. Show them as muted text beside menu items.
- **Pointer and keyboard first:** the app is used with a mouse and keyboard. Hover states are part of the design (branch dot, Keep label, Ask AI, full AI answer on hover), so don't hide anything important behind hover alone: every hover action also has a keyboard or menu route.
- **System theme:** follow the operating system's light or dark setting. Use the dark values from section 2.
- **Text selection:** user text and AI text are selectable. Controls and the canvas background are not (`user-select: none`), so dragging never selects page chrome by accident.
- **Cursors:** default arrow on the canvas, grab on empty space, grabbing while panning, move on draggable nodes, text cursor inside text.
- **Fonts:** bundle Inter and Newsreader with the app so it looks the same offline and on every platform. Keep the system font as a fallback.
- **Pasted images:** show a subtle outline while a pasted image is being saved, then remove it. No toast or dialog.
- **Offline by default:** the app never needs the internet. When LM Studio isn't running, the AI toggle shows `AI: Offline` in muted text, with no popup.
- **Scrollbars:** thin, `--line` colored, visible only while scrolling.

---

## 13. Quick CSS tokens

```css
:root {
  --bg: #F3F3EF;
  --bg-subtle: #ECECE7;
  --text: #1A1A1A;
  --text-muted: #8A8A85;
  --text-faint: #B8B8B2;
  --line: #D9D9D3;
  --ai: #2F6F6A;
  --ai-soft: #E4EFEE;
  --ai-line: #9CC2BE;
  --font-sans: "Inter", "Geist", system-ui, sans-serif;
  --font-serif: "Newsreader", "Source Serif 4", Georgia, serif;
  --radius-sm: 3px;
  --radius-md: 6px;
}
```
