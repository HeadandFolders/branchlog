import type { EarlierTask } from '@shared/types'

export interface MapSearch {
  search: (query: string) => EarlierTask[]
  choose: (taskId: string) => void
}

let active: MapSearch | null = null

export function registerMapSearch(search: MapSearch): () => void {
  active = search
  return () => {
    if (active === search) active = null
  }
}

export function mapSearch(): MapSearch | null {
  return active
}