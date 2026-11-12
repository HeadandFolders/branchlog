import { splitRequestPrefix } from '@shared/ai-request'
import { attributeTask, type AttributionBrief, type ProjectCorrection } from '@shared/project-attribution'

export const MIN_COMMENT_CHARS = 12

export interface TriggerTask {
  id: string
  text: string
  side: 'main' | 'right'
  done: boolean
  droppedAt: string | null
  projectId: string | null
  holdDismissed: boolean
  correction: ProjectCorrection | null
}

export interface TriggerOptions {
  enabled: boolean
  pauseMs: number
  remarkOnRequests: boolean
  briefs: readonly AttributionBrief[]
  dayNote: string
}

export interface TriggerDeps {
  schedule: (fn: () => void, ms: number) => number
  cancel: (handle: number) => void
  fire: (taskId: string, text: string) => void
  // True when the day still has room for the question, so the row can wear the affordance.
  hold: (taskId: string) => boolean
}

export interface AiTrigger {
  textChanged: (task: TriggerTask, options: TriggerOptions) => void
  commitRemark: (task: TriggerTask, options: TriggerOptions) => void
  consume: (taskId: string, text: string) => void
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

  // A request row is answered on a commit, so the pause may only remark it when the person asked
  // for both outputs.
  const remarkReady = (task: TriggerTask, options: TriggerOptions): boolean => {
    if (!options.enabled) return false
    if (task.side !== 'main' || task.done || task.droppedAt !== null) return false
    if (task.text.trim().length < MIN_COMMENT_CHARS) return false
    return !splitRequestPrefix(task.text).isRequest || options.remarkOnRequests
  }

  const markSent = (taskId: string, text: string): boolean => {
    const texts = sent.get(taskId) ?? new Set<string>()
    if (texts.has(text)) return false
    texts.add(text)
    sent.set(taskId, texts)
    return true
  }

  const unmarkSent = (taskId: string, text: string): void => {
    sent.get(taskId)?.delete(text)
  }

  // Which project a comment is written under is settled here, before any call: a row that could be
  // two different projects asks the person instead of spending a request on a guess.
  const answer = (task: TriggerTask, options: TriggerOptions): void => {
    const attribution = attributeTask({
      text: task.text,
      projectId: task.projectId,
      briefs: options.briefs,
      dayNote: options.dayNote,
      holdDismissed: task.holdDismissed,
      correction: task.correction,
    })
    if (attribution.kind === 'run') {
      if (!markSent(task.id, task.text)) return
      deps.fire(task.id, task.text)
      return
    }
    if (!markSent(task.id, task.text)) return
    // Past the day's cap the pause never happened: no question, no ask, and the text is left unspent
    // so a later edit can still be asked properly.
    if (!deps.hold(task.id)) unmarkSent(task.id, task.text)
  }

  return {
    textChanged(task, options) {
      cancel(task.id)
      if (!remarkReady(task, options)) return
      timers.set(
        task.id,
        deps.schedule(() => {
          timers.delete(task.id)
          answer(task, options)
        }, options.pauseMs),
      )
    },
    // An explicit ask is the person speaking, so it is answered whatever the project turns out to be.
    commitRemark(task, options) {
      cancel(task.id)
      if (!remarkReady(task, options)) return
      if (!markSent(task.id, task.text)) return
      deps.fire(task.id, task.text)
    },
    consume(taskId, text) {
      cancel(taskId)
      markSent(taskId, text)
    },
    cancel,
    reset() {
      for (const handle of timers.values()) deps.cancel(handle)
      timers.clear()
      sent.clear()
    },
  }
}
