import { Component, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { AiSettings } from './components/AiSettings'
import { AiStatusNote } from './components/AiStatusNote'
import { CalendarView } from './components/CalendarView'
import { DailyCanvas } from './components/DailyCanvas'
import { EarlierSearch } from './components/EarlierSearch'
import { ThemeLab } from './components/ThemeLab'
import { DeleteNotice } from './components/DeleteNotice'
import { TopBar } from './components/TopBar'
import { branchFromShortcut, installBranchShortcut } from './lib/branch-from'
import { installAiSettingsShortcut } from './lib/ai-settings-keys'
import { installAiTrigger } from './lib/ai-trigger-install'
import { installEarlierShortcut, openEarlierSearch } from './lib/earlier-search'
import { installNewTaskShortcut } from './lib/new-task'
import { copyFromMenu, cutFromMenu, selectAllFromMenu } from './lib/list-edit'
import { installImagePaste } from './lib/paste-image'
import { installImageDrop } from './lib/drop-image'
import { flushTheme, installThemeShortcut, toggleThemeLab } from './lib/theme-engine'
import { useCarrySync } from './store/carry-sync'
import { toggleAiSettings } from './store/ai-settings'
import { installHistoryKeys, redoEditing, undoEditing } from './store/history'
import { installImageLoader } from './store/images'
import { useNotebook } from './store/notebook'
import { usePreferences } from './store/preferences'
import { useView } from './store/view'
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
  useCarrySync()
  const error = useNotebook((state) => state.error)
  const goToDate = useNotebook((state) => state.goToDate)
  const view = useView((state) => state.view)

  useEffect(() => {
    usePreferences.getState().load()
    void goToDate(useNotebook.getState().currentDate)
    const unsubscribe = window.branchlog.onMenuAction((action) => {
      if (action === 'undo') undoEditing()
      else if (action === 'redo') redoEditing()
      else if (action === 'cut') cutFromMenu()
      else if (action === 'copy') copyFromMenu()
      else if (action === 'select-all') selectAllFromMenu()
      else if (action === 'branch-task') branchFromShortcut()
      else if (action === 'earlier-task') openEarlierSearch()
      else if (action === 'theme-lab') toggleThemeLab()
      else if (action === 'ai-settings') toggleAiSettings()
      else if (action === 'show-calendar') useView.getState().showCalendar()
      else useNotebook.getState().runMenuAction(action)
    })
    const removeHistoryKeys = installHistoryKeys()
    const removeBranchShortcut = installBranchShortcut()
    const removeEarlierShortcut = installEarlierShortcut()
    const removeNewTaskShortcut = installNewTaskShortcut()
    const removeThemeShortcut = installThemeShortcut()
    const removeAiSettingsShortcut = installAiSettingsShortcut()
    const removeImages = installImageLoader()
    const removePaste = installImagePaste()
    const removeDrop = installImageDrop()
    const removeAiTrigger = installAiTrigger()
    const onUnload = (): void => {
      useNotebook.getState().flushPendingSync()
      flushTheme()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      unsubscribe()
      removeHistoryKeys()
      removeBranchShortcut()
      removeEarlierShortcut()
      removeNewTaskShortcut()
      removeThemeShortcut()
      removeAiSettingsShortcut()
      removeImages()
      removePaste()
      removeDrop()
      removeAiTrigger()
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [goToDate])

  return (
    <div className="relative flex h-full flex-col bg-[var(--bg)]">
      <TopBar />
      <EarlierSearch />
      <main className="min-h-0 flex-1">
        {view === 'calendar' ? <CalendarView /> : <DailyCanvas />}
      </main>
      <ThemeLab />
      <AiSettings />
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2">
        <DeleteNotice />
        <AiStatusNote />
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
