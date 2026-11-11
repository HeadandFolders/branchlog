import { localDateKey } from '@shared/dates'
import type { Task } from '@shared/types'
import { layoutBeforeWrite } from './layout-bridge'
import { useNotebook } from './notebook'

let pending = false

function byListOrder(a: Task, b: Task): number {
  if (a.side !== b.side) return a.side === 'main' ? -1 : 1
  return a.orderIndex - b.orderIndex
}

export async function continueOntoToday(parentId: string): Promise<void> {
  if (pending) return
  const notebook = useNotebook.getState()
  if (!notebook.ready) {
    useNotebook.setState({ error: 'Could not branch from that task.' })
    return
  }
  pending = true
  try {
    layoutBeforeWrite('')
    const today = localDateKey()
    const openedElsewhere = notebook.currentDate !== today
    let result
    try {
      result = window.branchlog.tasks.createContinuationSync({
        id: crypto.randomUUID(),
        parentId,
        text: '',
      })
    } catch (error) {
      console.error(error)
      useNotebook.setState({ error: 'Could not branch from that task.' })
      return
    }
    if (!result.ok) {
      useNotebook.setState({ error: 'Could not branch from that task.' })
      return
    }
    const task = result.task
    const mark = result.continuation
    if (openedElsewhere) {
      await useNotebook.getState().goToDate(today)
    }
    useNotebook.setState((state) => {
      if (state.currentDate !== today || !state.ready) return state
      if (openedElsewhere && state.error) return state
      const present = state.tasks.some((item) => item.id === task.id)
      return {
        tasks: present ? state.tasks : [...state.tasks, task].sort(byListOrder),
        continuations: state.continuations[task.id]
          ? state.continuations
          : { ...state.continuations, [task.id]: mark },
        focusedId: task.id,
        focusRequest: { id: task.id, offset: 0, anchor: true },
        error: null,
      }
    })
  } finally {
    pending = false
  }
}
