# Color audit

Read from `src/renderer` before Theme Lab. The default palette in `globals.css` was already tokenized. These are the colors that were not.

## Moved onto tokens

| Where | Was | Now | Same value |
|---|---|---|---|
| `globals.css` checkbox border | `color-mix(in srgb, var(--text) 58%, var(--bg))` | `--check-border` | `#757573` / `#93938f` |
| `globals.css` edge hover | `color-mix(in srgb, var(--text) 45%, var(--line))` | `--edge-hover` | `#838380` / `#8b8b86` |
| `globals.css` branch dot at rest | `--accent-dot` at 60% opacity | `--accent-dot-rest` | `#71716f` / `#979793` composited on `--bg` |
| `globals.css` focus outlines | `var(--text)` | `--focus-ring` | same hex as `--text` |
| `src/renderer/src/lib/canvas-graph.ts` edge and arrow | `var(--line)` | `--edge` | same hex as `--line` |
| React Flow selection wash (`style.css`) | `rgba(0, 89, 220, 0.08)` and `rgba(0, 89, 220, 0.8)` over the page | `--selection-fill`, `--selection` | `#e0e7ed` / `#3178e0` light, `#242424` / `#a4a4b4` dark, the solid mix on `--bg` |
| AI connector, not drawn yet | would have been `--ai-line` | `--edge-ai` | same hex as `--ai-line` |
| `src/main/index.ts` window background | `#F3F3EF` / `#161614` | shared default `--bg` | same hex |

React Flow's bundled `style.css` hardcoded a second palette (`#b1b1b7`, `#fff`, `#3367d9`, `#999`, `#777`, and the dark set). The build rewrites those to `var(--line)`. Rules the page actually shows (edges, arrowheads, selection, resize handles, attribution) are overridden in `globals.css` with the tokens above. Resize handles were already `--bg` and `--text-faint`. Attribution was already `--text-faint`.

No Tailwind class used a fixed palette such as `text-gray-500`. No component passed a hex into React Flow. Lucide icons use `currentColor`.

## Left as non-colors

- `transparent` and `none` are the absence of a paint, not a palette color. Handles, empty buttons, and scrollbars use them.
- `::highlight(task-selection)` uses the system keywords `Highlight` and `HighlightText`. Those follow the platform selection color. A fixed hex would change it, and they are not stored in a theme.
- The date picker's fade (`opacity: 0.45` / `0.85`) is the native calendar icon, not a color we can name.

## Default theme

With Theme Lab closed and nothing saved, every token matches the list in `src/shared/theme.ts` and `globals.css`. Dark mode still follows `prefers-color-scheme` until a preview or a saved mode sets `data-theme`.
