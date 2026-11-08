import { Component, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { DailyCanvas } from './components/DailyCanvas'
import { DeleteNotice } from './components/DeleteNotice'
import { TopBar } from './components/TopBar'
import { branchFromShortcut, installBranchShortcut } from './lib/branch-from'
import { installNewTaskShortcut } from './lib/new-task'
import { copyFromMenu, cutFromMenu, selectAllFromMenu } from './lib/list-edit'
import { installHistoryKeys, redoEditing, undoEditing } from './store/history'
import { useNotebook } from './store/notebook'
import { tempCountRender, tempNoteCommit } from './temp-first-paint'

interface BoundaryProps {
  children: ReactNode
}

interface BoundaryState {
  failed: boolean
}

class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error(error)
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="flex h-full items-center justify-center px-8 text-center text-[13px] text-[var(--text-muted)]">
          Branchlog hit a problem and stopped drawing this page.
        </div>
      )
    }
    return this.props.children
  }
}

function Notebook() {
  tempCountRender('Notebook')
  const error = useNotebook((state) => state.error)
  const goToDate = useNotebook((state) => state.goToDate)

  useEffect(() => {
    void goToDate(useNotebook.getState().currentDate)
    const unsubscribe = window.branchlog.onMenuAction((action) => {
      if (action === 'undo') undoEditing()
      else if (action === 'redo') redoEditing()
      else if (action === 'cut') cutFromMenu()
      else if (action === 'copy') copyFromMenu()
      else if (action === 'select-all') selectAllFromMenu()
      else if (action === 'branch-task') branchFromShortcut()
      else useNotebook.getState().runMenuAction(action)
    })
    const removeHistoryKeys = installHistoryKeys()
    const removeBranchShortcut = installBranchShortcut()
    const removeNewTaskShortcut = installNewTaskShortcut()
    const onUnload = (): void => {
      useNotebook.getState().flushPendingSync()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      unsubscribe()
      removeHistoryKeys()
      removeBranchShortcut()
      removeNewTaskShortcut()
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [goToDate])

  return (
    <div className="relative flex h-full flex-col bg-[var(--bg)]">
      <TopBar />
      <main className="min-h-0 flex-1">
        <DailyCanvas />
      </main>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2">
        <DeleteNotice />
        {error ? (
          <p className="text-center text-[12px] text-[var(--text-muted)]" role="status">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function App() {
  tempCountRender('App')
  useLayoutEffect(() => {
    tempNoteCommit()
  }, [])

  if (!('branchlog' in window)) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-[13px] text-[var(--text-muted)]">
        Open Branchlog from the desktop app.
      </div>
    )
  }

  return (
    <AppErrorBoundary>
      <Notebook />
    </AppErrorBoundary>
  )
}
