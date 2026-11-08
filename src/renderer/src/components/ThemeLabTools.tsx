import { useRef, useState } from 'react'
import {
  CONTRAST_PAIRS,
  contrastRatio,
  formatRatio,
  parseThemeExchange,
  passesAa,
  themeToCss,
  themeToJson,
  type Palette,
  type ThemeDocument,
} from '@shared/theme'
import { accentFromHue, hexToHsl, randomPalettes, swapped } from '@shared/theme-harmony'
import {
  deletePreset,
  endCompareHold,
  endGesture,
  loadPreset,
  renamePreset,
  replacePalettes,
  savePreset,
  setExportText,
  showCompare,
  toggleCompare,
} from '../lib/theme-engine'

export function ContrastList({ palette }: { palette: Palette }) {
  return (
    <ul aria-label="Contrast" className="flex flex-col gap-1">
      {CONTRAST_PAIRS.map((pair) => {
        const ratio = contrastRatio(palette[pair.fg], palette[pair.bg])
        const pass = passesAa(ratio)
        return (
          <li key={pair.id} className="flex items-center justify-between gap-2">
            <span>{pair.label}</span>
            <span data-contrast={pair.id}>{formatRatio(ratio)}</span>
            <span data-contrast-pass={pair.id}>{pass ? 'Pass' : 'Fail'}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function ThemeHarmony({ doc, mode }: { doc: ThemeDocument; mode: ThemeDocument['mode'] }) {
  const hue = Math.round(hexToHsl(doc[mode].ai).h)
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => {
          const next = randomPalettes(Math.random() * 360)
          replacePalettes(next.light, next.dark)
        }}
      >
        Randomize
      </button>
      <label className="flex flex-col gap-1">
        Accent from hue
        <input
          type="range"
          min={0}
          max={360}
          aria-label="Accent from hue"
          value={hue}
          onInput={(event) => {
            const nextHue = Number(event.currentTarget.value)
            replacePalettes(accentFromHue(doc.light, nextHue), accentFromHue(doc.dark, nextHue), 'move')
          }}
          onPointerUp={() => endGesture()}
          onBlur={() => endGesture()}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          const next = swapped(doc.light, doc.dark)
          replacePalettes(next.light, next.dark)
        }}
      >
        Swap light and dark
      </button>
    </div>
  )
}

export function ThemePresets({ doc, comparing }: { doc: ThemeDocument; comparing: boolean }) {
  const [name, setName] = useState('')
  const down = useRef(0)
  const held = useRef(false)

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[12px] text-[var(--text-muted)]">Presets</h3>
      <div className="flex items-center justify-between gap-2">
        <span>Default</span>
        <button type="button" onClick={() => loadPreset('default')}>
          Load Default
        </button>
      </div>
      <p className="text-[var(--text-faint)]">Default is built in. It cannot be renamed or deleted.</p>
      {doc.presets.map((preset) => (
        <PresetRow key={preset.id} id={preset.id} name={preset.name} />
      ))}
      <label className="flex flex-col gap-1">
        Preset name
        <input aria-label="Preset name" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => {
          savePreset(name)
          setName('')
        }}
      >
        Save theme
      </button>
      <button
        type="button"
        aria-pressed={comparing}
        disabled={doc.presets.length === 0}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          down.current = Date.now()
          showCompare(true)
        }}
        onPointerUp={() => {
          held.current = Date.now() - down.current > 300
          if (held.current) endCompareHold()
        }}
        onClick={() => {
          if (held.current) {
            held.current = false
            return
          }
          toggleCompare()
        }}
      >
        Compare saved
      </button>
    </div>
  )
}

function PresetRow({ id, name }: { id: string; name: string }) {
  const [draft, setDraft] = useState(name)
  const [seen, setSeen] = useState(name)
  if (seen !== name) {
    setSeen(name)
    setDraft(name)
  }
  return (
    <div className="flex flex-col gap-1" data-preset={name}>
      <span>{name}</span>
      <button type="button" onClick={() => loadPreset(id)}>
        Load {name}
      </button>
      <label className="flex flex-col gap-1">
        Rename {name}
        <input aria-label={`Rename ${name}`} value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <button type="button" onClick={() => renamePreset(id, draft)}>
        Rename
      </button>
      <button type="button" onClick={() => deletePreset(id)}>
        Delete {name}
      </button>
    </div>
  )
}

export function ThemeExchange({ doc, exportText }: { doc: ThemeDocument; exportText: string }) {
  const [raw, setRaw] = useState('')
  const [importError, setImportError] = useState('')

  const copy = (text: string): void => {
    setExportText(text)
    void navigator.clipboard.writeText(text).catch(() => undefined)
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => copy(themeToCss(doc.light, doc.dark))}>
        Copy as CSS
      </button>
      <button type="button" onClick={() => copy(themeToJson(doc.light, doc.dark))}>
        Copy as JSON
      </button>
      <label className="flex flex-col gap-1">
        Export
        <textarea aria-label="Theme export" readOnly value={exportText} />
      </label>
      <label className="flex flex-col gap-1">
        Import JSON
        <textarea aria-label="Import JSON" value={raw} onChange={(event) => setRaw(event.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => {
          try {
            const next = parseThemeExchange(raw)
            replacePalettes(next.light, next.dark)
            setImportError('')
          } catch (caught) {
            setImportError(caught instanceof Error ? caught.message : 'Invalid theme JSON')
          }
        }}
      >
        Import
      </button>
      {importError ? (
        <p role="alert" data-import-error="true">
          {importError}
        </p>
      ) : null}
    </div>
  )
}
