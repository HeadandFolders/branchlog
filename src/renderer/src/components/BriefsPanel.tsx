import { useCallback, useState } from 'react'
import { BRIEFS_MAX_CHARS_RANGE, type BriefResult } from '@shared/ai-briefs'
import { reloadBriefs, useBriefs } from '../store/briefs'
import '../styles/briefs.css'

function failureText(result: BriefResult): string {
  return result.ok ? '' : (result.message ?? 'That did not work.')
}

export function BriefsPanel() {
  const briefs = useBriefs((state) => state.briefs)
  const listError = useBriefs((state) => state.error)
  const [maxChars, setMaxChars] = useState(() => window.branchlog.briefs.maxCharsSync())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(
    async (action: () => Promise<BriefResult>): Promise<void> => {
      setBusy(true)
      setError('')
      try {
        const result = await action()
        const message = failureText(result)
        if (message !== '') setError(message)
        await reloadBriefs()
      } catch (err) {
        console.error(err)
        setError('That did not work.')
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const commitMaxChars = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) return
    const value = Math.min(BRIEFS_MAX_CHARS_RANGE.max, Math.max(BRIEFS_MAX_CHARS_RANGE.min, parsed))
    if (value === maxChars) return
    setMaxChars(value)
    if (!window.branchlog.briefs.setMaxCharsSync(value)) setError('The brief limit could not be saved.')
  }

  return (
    <section className="briefs" aria-label="Briefs">
      <h3 className="briefs-title">Briefs</h3>
      <p className="ai-settings-note">
        Your own project notes, read from the files where they live. The AI gets them as reference only and never
        writes to them.
      </p>
      <div className="briefs-links">
        <button
          type="button"
          data-brief-link-folder="true"
          disabled={busy}
          onClick={() => void run(() => window.branchlog.briefs.linkFolder())}
        >
          Link a folder
        </button>
        <button
          type="button"
          data-brief-link-files="true"
          disabled={busy}
          onClick={() => void run(() => window.branchlog.briefs.linkFiles())}
        >
          Link files
        </button>
      </div>
      <label>
        Longest brief text (characters)
        <input
          type="number"
          data-briefs-max-chars="true"
          min={BRIEFS_MAX_CHARS_RANGE.min}
          max={BRIEFS_MAX_CHARS_RANGE.max}
          step={100}
          value={maxChars}
          onChange={(event) => commitMaxChars(event.target.value)}
        />
      </label>
      {briefs.length === 0 ? (
        <p className="ai-settings-note" data-briefs-empty="true">
          No briefs linked yet.
        </p>
      ) : (
        <ul className="briefs-list">
          {briefs.map((brief) => (
            <li className="briefs-item" key={brief.id} data-brief={brief.name}>
              <div className="briefs-item-head">
                <span className="briefs-item-name">{brief.name}</span>
                {brief.stale ? (
                  <span className="briefs-badge" data-brief-stale="true">
                    changed on disk
                  </span>
                ) : null}
                {brief.truncated ? (
                  <span className="briefs-badge" data-brief-truncated="true">
                    truncated
                  </span>
                ) : null}
                {brief.unreadable ? (
                  <span className="briefs-badge" data-brief-unreadable="true">
                    {brief.unreadable}
                  </span>
                ) : null}
              </div>
              <p className="briefs-summary">{brief.summary === '' ? 'Nothing to summarise in this file.' : brief.summary}</p>
              <p className="briefs-path" title={brief.filePath}>
                {brief.filePath}
              </p>
              <div className="briefs-item-actions">
                <label>
                  <input
                    type="checkbox"
                    data-brief-enabled="true"
                    checked={brief.enabled}
                    disabled={busy}
                    onChange={(event) => {
                      const on = event.target.checked
                      void run(() => window.branchlog.briefs.setEnabled(brief.id, on))
                    }}
                  />
                  Use
                </label>
                <label>
                  <input
                    type="checkbox"
                    data-brief-always="true"
                    checked={brief.alwaysInclude}
                    disabled={busy}
                    onChange={(event) => {
                      const on = event.target.checked
                      void run(() => window.branchlog.briefs.setAlwaysInclude(brief.id, on))
                    }}
                  />
                  Always include
                </label>
                <button
                  type="button"
                  data-brief-reread="true"
                  disabled={busy}
                  onClick={() => void run(() => window.branchlog.briefs.refresh(brief.id))}
                >
                  Re-read
                </button>
                <button
                  type="button"
                  data-brief-remove="true"
                  disabled={busy}
                  onClick={() => void run(() => window.branchlog.briefs.remove(brief.id))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error !== '' || listError !== null ? (
        <p className="ai-settings-note" role="alert" data-briefs-error="true">
          {error === '' ? listError : error}
        </p>
      ) : null}
    </section>
  )
}
