import { create } from 'zustand'
import type { CanvasImage } from '@shared/types'
import { setImageRestorer } from './history'
import { useNotebook } from './notebook'

interface ImageState {
  date: string
  images: CanvasImage[]
  ready: boolean
  load: (date: string) => Promise<void>
  add: (image: CanvasImage) => void
  move: (id: string, x: number, y: number) => void
  place: (moves: readonly { id: string; x: number; y: number }[]) => void
  replace: (images: CanvasImage[]) => void
}

function sameDate(images: CanvasImage[], date: string): boolean {
  return images.every((image) => image.dateKey === date)
}

export const useImages = create<ImageState>((set, get) => ({
  date: '',
  images: [],
  ready: false,

  load: async (date) => {
    set({ date, ready: false, images: [] })
    try {
      const images = await window.branchlog.images.listByDate(date)
      if (get().date !== date || useNotebook.getState().currentDate !== date) return
      set({ images, ready: true })
    } catch (error) {
      console.error(error)
      if (get().date !== date) return
      set({ images: [], ready: true })
    }
  },

  add: (image) => {
    set((state) => ({ images: [...state.images, image], ready: true }))
  },

  move: (id, x, y) => {
    set((state) => ({
      images: state.images.map((image) => (image.id === id ? { ...image, x, y } : image)),
    }))
  },

  place: (moves) => {
    if (moves.length === 0) return
    const moved = new Map(moves.map((move) => [move.id, move]))
    set((state) => ({
      images: state.images.map((image) => {
        const next = moved.get(image.id)
        return next ? { ...image, x: next.x, y: next.y } : image
      }),
    }))
  },

  replace: (images) => {
    const date = useNotebook.getState().currentDate
    if (!sameDate(images, date)) return
    set({ images, date, ready: true })
    const wrote = window.branchlog.images.replaceSync(
      date,
      images.map((image) => ({
        id: image.id,
        dateKey: image.dateKey,
        fileName: image.fileName,
        x: image.x,
        y: image.y,
        width: image.width,
        height: image.height,
      })),
    )
    if (!wrote.ok) useNotebook.setState({ error: 'Could not undo that edit.' })
  },
}))

setImageRestorer((images) => {
  useImages.getState().replace(images)
})

export function installImageLoader(): () => void {
  return useNotebook.subscribe((state, prev) => {
    if (!state.ready || state.currentDate === '') return
    if (prev.ready && prev.currentDate === state.currentDate) return
    void useImages.getState().load(state.currentDate)
  })
}
