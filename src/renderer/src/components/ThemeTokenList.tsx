import { useState } from 'react'
import { THEME_GROUPS, defaultPalette, type ThemeMode, type ThemeToken } from '@shared/theme'
import { tokenChanged } from '@shared/theme-harmony'
import { editToken, endGesture } from '../lib/theme-engine'

function TokenRow({ mode, token, value }: { mode: ThemeMode; token: ThemeToken; value: string }) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }
  const changed = tokenChanged(mode, token, value)
  const invalid = draft.trim().toLowerCase() !== value && !/^#[0-9a-f]{6}$/i.test(draft.trim())

  return (
    <div className="theme-row" data-token={token} data-changed={changed ? 'true' : 'false'}>
      <input
        type="color"
        aria-label={`${token} color`}
        value={value}
        onInput={(event) => editToken(mode, token, event.currentTarget.value.toLowerCase(), 'move')}
        onBlur={() => endGesture()}
        onPointerUp={() => endGesture()}
      />
      <input
        type="text"
        aria-label={`${token} hex`}
        aria-invalid={invalid}
        value={draft}
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          const hex = next.trim().toLowerCase()
          if (/^#[0-9a-f]{6}$/.test(hex)) editToken(mode, token, hex, 'move')
        }}
        onBlur={() => endGesture()}
      />
      <code className="token-name">{changed ? 'Changed ' : null}--{token}</code>
      <button
        type="button"
        aria-label={`Reset --${token}`}
        disabled={!changed}
        onClick={() => editToken(mode, token, defaultPalette(mode)[token], 'once')}
      >
        Reset
      </button>
    </div>
  )
}

export function ThemeTokenList({ mode, values }: { mode: ThemeMode; values: Record<ThemeToken, string> }) {
  return (
    <div>
      {THEME_GROUPS.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className="mb-2 mt-3 text-[12px] text-[var(--text-muted)]">{group.label}</h3>
          {group.tokens.map((token) => (
            <TokenRow key={token} mode={mode} token={token} value={values[token]} />
          ))}
        </section>
      ))}
    </div>
  )
}
