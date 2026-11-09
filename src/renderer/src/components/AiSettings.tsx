import { useState } from 'react'
import { isPrivateAddress, MAX_COMMENTS_RANGE, PAUSE_DELAY_RANGE, parseBaseUrl } from '@shared/ai-settings'
import { useAiSettings } from '../store/ai-settings'

function validUrl(value: string): boolean {
  try {
    parseBaseUrl(value)
    return true
  } catch {
    return false
  }
}

export function AiSettings() {
  const open = useAiSettings((state) => state.open)
  if (!open) return null
  return <AiSettingsPanel />
}

function AiSettingsPanel() {
  const settings = useAiSettings((state) => state.settings)
  const testing = useAiSettings((state) => state.testing)
  const connection = useAiSettings((state) => state.connection)
  const error = useAiSettings((state) => state.error)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [model, setModel] = useState(settings.model)

  const update = useAiSettings((state) => state.update)
  const commitBaseUrl = (): void => {
    if (baseUrl !== settings.baseUrl) update({ baseUrl })
  }
  const commitModel = (): void => {
    if (model !== settings.model) update({ model })
  }
  const numberCommit = (raw: string, key: 'maxCommentsPerDay' | 'pauseDelayMs', min: number, max: number): void => {
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) return
    const value = Math.min(max, Math.max(min, parsed))
    if (value !== settings[key]) update({ [key]: value })
  }
  const remote = validUrl(baseUrl) && !isPrivateAddress(baseUrl)

  return (
    <aside className="ai-settings nowheel" role="complementary" aria-label="AI margin settings">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-[14px] text-[var(--text)]">AI margin</h2>
        <button type="button" onClick={() => useAiSettings.getState().hide()} aria-label="Close AI settings">
          Close
        </button>
      </header>
      <div className="ai-settings-body">
        <p className="ai-settings-note">
          A quiet companion on the left of your list, powered by LM Studio on this computer. It only writes comments,
          never your tasks.
        </p>
        <label>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          Enable margin comments
        </label>
        <label>
          LM Studio address
          <input
            type="text"
            value={baseUrl}
            spellCheck={false}
            onChange={(event) => setBaseUrl(event.target.value)}
            onBlur={commitBaseUrl}
          />
        </label>
        <label>
          Model (blank uses the first loaded model)
          <input
            type="text"
            value={model}
            spellCheck={false}
            onChange={(event) => setModel(event.target.value)}
            onBlur={commitModel}
          />
        </label>
        <label>
          Max comments per day
          <input
            type="number"
            min={MAX_COMMENTS_RANGE.min}
            max={MAX_COMMENTS_RANGE.max}
            value={settings.maxCommentsPerDay}
            onChange={(event) =>
              numberCommit(event.target.value, 'maxCommentsPerDay', MAX_COMMENTS_RANGE.min, MAX_COMMENTS_RANGE.max)
            }
          />
        </label>
        <label>
          Pause before commenting (ms)
          <input
            type="number"
            min={PAUSE_DELAY_RANGE.min}
            max={PAUSE_DELAY_RANGE.max}
            step={100}
            value={settings.pauseDelayMs}
            onChange={(event) =>
              numberCommit(event.target.value, 'pauseDelayMs', PAUSE_DELAY_RANGE.min, PAUSE_DELAY_RANGE.max)
            }
          />
        </label>
        {remote ? (
          <p className="ai-settings-note" role="note" data-ai-remote-note="true">
            This address is not on your machine or private network. Your task text would be sent to it.
          </p>
        ) : null}
        <button
          type="button"
          className="ai-settings-test"
          disabled={testing}
          onClick={() => {
            if (!validUrl(baseUrl)) {
              useAiSettings.setState({ error: 'Invalid AI address', connection: null })
              return
            }
            commitBaseUrl()
            commitModel()
            void useAiSettings.getState().testConnection()
          }}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {connection ? (
          connection.ok ? (
            <p className="ai-settings-note" role="status" data-ai-connection="ok">
              Connected. Models: {connection.models.join(', ')}
            </p>
          ) : (
            <p className="ai-settings-note" role="status" data-ai-connection="error">
              {connection.message}
            </p>
          )
        ) : null}
        {error ? (
          <p className="ai-settings-note" role="alert" data-ai-settings-error="true">
            {error}
          </p>
        ) : null}
      </div>
    </aside>
  )
}