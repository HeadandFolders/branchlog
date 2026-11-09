import type { Task } from '@shared/types'
import { MAX_ANCESTORS } from './ai-prompts'
import { getTask } from './database'

export function ancestorsOf(task: Task): Task[] {
  const chain: Task[] = []
  let parentId = task.parentId
  while (parentId && chain.length < MAX_ANCESTORS) {
    const parent = getTask(parentId)
    if (!parent) break
    chain.push(parent)
    parentId = parent.parentId
  }
  return chain
}
