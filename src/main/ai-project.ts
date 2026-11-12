import { attributeTask } from '@shared/project-attribution'
import type { Task } from '@shared/types'
import { listBriefs, latestProjectCorrection } from './ai-store'
import { readDayNoteText } from './day-note'

export interface CommentProject {
  projectId: string | null
  projectPinned: boolean
}

// What project an answer belongs to, decided from the notebook rather than from what the page
// believed a moment ago. The page asks the same question to decide whether to hold the row, so the
// label and the ask are never two different answers.
export function projectForComment(task: Task): CommentProject {
  const attribution = attributeTask({
    text: task.text,
    projectId: task.projectId,
    briefs: listBriefs(),
    dayNote: readDayNoteText(task.dateCreated),
    holdDismissed: task.projectHoldDismissed,
    correction: latestProjectCorrection(task.id),
  })
  // A row the page would have held is still worth a comment once the person asked for it, and the
  // only honest label on it is no project at all.
  if (attribution.kind === 'hold') return { projectId: null, projectPinned: false }
  return {
    projectId: attribution.briefId,
    projectPinned: attribution.source === 'correction',
  }
}

// The attributed brief joins the ones the row and the day note already named, so the answer really is
// written with that brief in front of the model.
export function briefIdsForProject(refs: string[], projectId: string | null): string[] {
  if (projectId === null || refs.includes(projectId)) return refs
  return [...refs, projectId]
}
