import { Component, useEffect, type ReactNode } from 'react'
import { DailyCanvas } from './components/DailyCanvas'
import { TopBar } from './components/TopBar'
import { useNotebook } from './store/notebook'

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
  const error = useNotebook((state) => state.error)
  const goToDate = useNotebook((state) => state.goToDate)

  useEffect(() => {
    void goToDate(useNotebook.getState().currentDate)
    const unsubscribe = window.branchlog.onMenuAction((action) => {
      useNotebook.getState().runMenuAction(action)
    })
    const onUnload = (): void => {
      useNotebook.getState().flushPendingSync()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      unsubscribe()
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [goToDate])

  return (
    <div className="relative flex h-full flex-col bg-[var(--bg)]">
      <TopBar />
      <main className="min-h-0 flex-1">
        <DailyCanvas />
      </main>
      {error ? (
        <p className="pointer-events-none absolute bottom-4 left-0 right-0 text-center text-[12px] text-[var(--text-muted)]" role="status">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function App() {
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
