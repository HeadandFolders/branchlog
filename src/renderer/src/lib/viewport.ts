type FramePage = () => void

let framePage: FramePage | null = null

export function registerFramePage(fn: FramePage): () => void {
  framePage = fn
  return () => {
    if (framePage === fn) framePage = null
  }
}

export function framePageNow(): void {
  framePage?.()
}
