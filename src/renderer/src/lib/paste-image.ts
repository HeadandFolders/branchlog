import { flowPoint } from './branch-from'
import { pushImageHistory } from '../store/history'
import { useImages } from '../store/images'
import { useNotebook } from '../store/notebook'

let lastX = 0
let lastY = 0

export function installImagePaste(): () => void {
  const onPointerDown = (event: PointerEvent): void => {
    lastX = event.clientX
    lastY = event.clientY
  }
  const onPaste = (event: ClipboardEvent): void => {
    const data = event.clipboardData
    const files = data?.files
    const hasImageFile = Array.from(files ?? []).some((file) => file.type.startsWith('image/'))
    const text = data?.getData('text/plain') ?? ''
    const html = data?.getData('text/html') ?? ''
    if (!hasImageFile && (text !== '' || html !== '')) return
    const point = flowPoint({ x: lastX, y: lastY })
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    const before = useImages.getState().images.map((image) => ({ ...image }))
    void window.branchlog.images
      .paste({
        id: crypto.randomUUID(),
        dateKey: useNotebook.getState().currentDate,
        x: point.x,
        y: point.y,
      })
      .then((result) => {
        if (!result.ok) {
          useNotebook.setState({ error: 'Could not paste that image.' })
          return
        }
        useImages.getState().add(result.image)
        pushImageHistory(before, useImages.getState().images)
      })
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('paste', onPaste, true)
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('paste', onPaste, true)
  }
}
