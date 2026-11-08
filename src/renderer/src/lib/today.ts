import { useEffect, useState } from 'react'
import { localDateKey, msUntilNextLocalMidnight } from '@shared/dates'

export function useTodayKey(): string {
  const [today, setToday] = useState(() => localDateKey())

  useEffect(() => {
    let timer = 0
    const refresh = (): void => {
      setToday(localDateKey())
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, msUntilNextLocalMidnight())
    }
    timer = window.setTimeout(refresh, msUntilNextLocalMidnight())
    const onFocus = (): void => {
      refresh()
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    const removeResume = window.branchlog.onResume(refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      removeResume()
    }
  }, [])

  return today
}
