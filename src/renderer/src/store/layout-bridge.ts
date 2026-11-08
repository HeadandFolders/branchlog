type Phase = 'defer' | 'done'

interface Bridge {
  beforeWrite: (id: string) => Phase
  afterWrite: () => void
  prepareHistory: () => void
  markRestore: () => void
}

const idle: Bridge = {
  beforeWrite: () => 'done',
  afterWrite: () => undefined,
  prepareHistory: () => undefined,
  markRestore: () => undefined,
}

let bridge: Bridge = idle

export function registerLayoutBridge(next: Bridge): () => void {
  const previous = bridge
  bridge = next
  return () => {
    if (bridge === next) bridge = previous
  }
}

export function layoutBeforeWrite(id: string): Phase {
  return bridge.beforeWrite(id)
}

export function layoutAfterWrite(): void {
  bridge.afterWrite()
}

export function prepareHistoryStep(): void {
  bridge.prepareHistory()
}

export function markLayoutRestore(): void {
  bridge.markRestore()
}
