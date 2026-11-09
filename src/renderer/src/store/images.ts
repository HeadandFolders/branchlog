import { create } from 'zustand'
import type { CanvasImage, ImageCrop } from '@shared/types'
import { pushImageHistory, setImageRestorer } from './history'
import { useNotebook } from './notebook'

interface ImageState {
  date: string
  images: CanvasImage[]
  ready: boolean
  load: (date: string) => Promise<void>
  add: (image: CanvasImage) => void
  move: (id: string, x: number, y: number) => void
  resize: (id: string, x: number, y: number, width: number, height: number, crop: ImageCrop) => void
  remove: (ids: readonly string[]) => void
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

  resize: (id, x, y, width, height, crop) => {
    set((state) => ({
      images: state.images.map((image) => (image.id === id ? { ...image, x, y, width, height, ...crop } : image)),
    }))
  },

  remove: (ids) => {
    const doomed = [...new Set(ids)]
    if (doomed.length === 0) return
    const wrote = window.branchlog.images.deleteSync({ ids: doomed })
    if (!wrote.ok) {
      useNotebook.setState({ error: 'Could not delete that image.' })
      return
    }
    const before = get().images.map((image) => ({ ...image }))
    const dropped = new Set(doomed)
    set({ images: before.filter((image) => !dropped.has(image.id)) })
    pushImageHistory(before, get().images)
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
        cropLeft: image.cropLeft,
        cropTop: image.cropTop,
        cropRight: image.cropRight,
        cropBottom: image.cropBottom,
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
