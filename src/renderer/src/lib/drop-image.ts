import { flowPoint } from './branch-from'
import { pushImageHistory } from '../store/history'
import { useImages } from '../store/images'
import { useNotebook } from '../store/notebook'

const CASCADE = 24

export function installImageDrop(): () => void {
  const onDragOver = (event: DragEvent): void => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (event: DragEvent): void => {
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    const point = flowPoint({ x: event.clientX, y: event.clientY })
    if (!point) return
    const dateKey = useNotebook.getState().currentDate
    const pictures = files.filter((file) => file.type.startsWith('image/'))
    if (pictures.length === 0) {
      useNotebook.setState({ error: 'Could not add that image.' })
      return
    }
    const before = useImages.getState().images.map((image) => ({ ...image }))
    void (async () => {
      let added = false
      let failed = pictures.length < files.length
      for (const [index, file] of pictures.entries()) {
        try {
          const result = await window.branchlog.images.drop({
            id: crypto.randomUUID(),
            dateKey,
            x: point.x + index * CASCADE,
            y: point.y + index * CASCADE,
            bytes: new Uint8Array(await file.arrayBuffer()),
          })
          if (!result.ok) {
            failed = true
            continue
          }
          useImages.getState().add(result.image)
          added = true
        } catch (error) {
          console.error(error)
          failed = true
        }
      }
      if (added) pushImageHistory(before, useImages.getState().images)
      if (failed || !added) useNotebook.setState({ error: 'Could not add that image.' })
    })()
  }
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('drop', onDrop)
  return () => {
    document.removeEventListener('dragover', onDragOver)
    document.removeEventListener('drop', onDrop)
  }
}
