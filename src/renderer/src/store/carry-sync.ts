import { useEffect, useRef } from 'react'
import type { CarryRun, Continuation } from '@shared/types'
import { recordCarry } from './history'
import { useNotebook } from './notebook'

const pending: CarryRun[] = []
const seen = new Set<string>()

function adopt(run: CarryRun): void {
  if (seen.has(run.id)) return
  if (!recordCarry(run.date, run.tasks)) {
    pending.push(run)
    return
  }
  seen.add(run.id)
  if (run.tasks.some((task) => task.parentId)) void refreshMarks(run.date)
}

function flush(date: string): void {
  const ready = pending.filter((run) => run.date === date)
  for (const run of ready) {
    const index = pending.indexOf(run)
    if (index >= 0) pending.splice(index, 1)
    adopt(run)
  }
}

async function refreshMarks(date: string): Promise<void> {
  try {
    const marks = await window.branchlog.tasks.continuations(date)
    if (useNotebook.getState().currentDate !== date) return
    const continuations: Record<string, Continuation> = {}
    for (const mark of marks) continuations[mark.taskId] = mark
    useNotebook.setState({ continuations })
  } catch (error) {
    console.error(error)
  }
}

export function useCarrySync(): void {
  const ready = useNotebook((state) => state.ready)
  const pulled = useRef(false)

  useEffect(() => {
    const unsubscribe = window.branchlog.carry.onApplied(adopt)
    const unsubscribeStore = useNotebook.subscribe((state, prev) => {
      if (!state.ready) return
      if (prev.ready && prev.currentDate === state.currentDate) return
      flush(state.currentDate)
    })
    return () => {
      unsubscribe()
      unsubscribeStore()
    }
  }, [])

  useEffect(() => {
    if (!ready || pulled.current) return
    pulled.current = true
    try {
      for (const run of window.branchlog.carry.ready()) adopt(run)
    } catch (error) {
      console.error(error)
      useNotebook.setState({ error: 'Could not carry unfinished tasks.' })
    }
  }, [ready])
}
