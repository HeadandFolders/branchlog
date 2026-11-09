export const MIN_COMMENT_CHARS = 12

export interface TriggerTask {
  id: string
  text: string
  side: 'main' | 'right'
  done: boolean
  droppedAt: string | null
}

export interface TriggerOptions {
  enabled: boolean
  pauseMs: number
}

export interface TriggerDeps {
  schedule: (fn: () => void, ms: number) => number
  cancel: (handle: number) => void
  fire: (taskId: string, text: string) => void
}

export interface AiTrigger {
  textChanged: (task: TriggerTask, options: TriggerOptions) => void
  cancel: (taskId: string) => void
  reset: () => void
}

export function createAiTrigger(deps: TriggerDeps): AiTrigger {
  const timers = new Map<string, number>()
  const sent = new Map<string, Set<string>>()

  const cancel = (taskId: string): void => {
    const handle = timers.get(taskId)
    if (handle === undefined) return
    deps.cancel(handle)
    timers.delete(taskId)
  }

  return {
    textChanged(task, options) {
      cancel(task.id)
      if (!options.enabled || task.side !== 'main' || task.done || task.droppedAt !== null) return
      if (task.text.trim().length < MIN_COMMENT_CHARS) return
      const texts = sent.get(task.id) ?? new Set<string>()
      if (texts.has(task.text)) return
      const text = task.text
      timers.set(
        task.id,
        deps.schedule(() => {
          timers.delete(task.id)
          texts.add(text)
          sent.set(task.id, texts)
          deps.fire(task.id, text)
        }, options.pauseMs),
      )
    },
    cancel,
    reset() {
      for (const handle of timers.values()) deps.cancel(handle)
      timers.clear()
      sent.clear()
    },
  }
}