import { shiftPendingSize } from './task-size'
import { foldMovedImages, foldMovedTasks } from './history'
import { useImages } from './images'
import { cancelPositionSaves, useNotebook } from './notebook'

export function commitLayoutMoves(
  positions: readonly { id: string; x: number; y: number }[],
  alsoId: string | null,
): void {
  const tasks = useNotebook.getState().tasks
  const images = useImages.getState().images
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const imageById = new Map(images.map((image) => [image.id, image]))
  const points = [...positions]
  if (alsoId && !points.some((point) => point.id === alsoId)) {
    const task = taskById.get(alsoId)
    const image = imageById.get(alsoId)
    if (task) points.push({ id: alsoId, x: task.x, y: task.y })
    else if (image) points.push({ id: alsoId, x: image.x, y: image.y })
  }
  const seen = new Set<string>()
  const taskMoves: { id: string; x: number; y: number }[] = []
  const imageMoves: { id: string; x: number; y: number }[] = []
  for (const point of points) {
    if (seen.has(point.id)) continue
    seen.add(point.id)
    const task = taskById.get(point.id)
    if (task) {
      const changed = task.x !== point.x || task.y !== point.y
      if (!changed && point.id !== alsoId) continue
      if (changed) shiftPendingSize(point.id, point.x, point.y)
      taskMoves.push(point)
      continue
    }
    const image = imageById.get(point.id)
    if (!image) continue
    if (image.x === point.x && image.y === point.y && point.id !== alsoId) continue
    imageMoves.push(point)
  }
  if (taskMoves.length === 0 && imageMoves.length === 0) return
  cancelPositionSaves(taskMoves.map((move) => move.id))
  foldMovedTasks(taskMoves.filter((move) => {
    const task = taskById.get(move.id)
    return Boolean(task && (task.x !== move.x || task.y !== move.y))
  }))
  if (imageMoves.length > 0) {
    useImages.getState().place(imageMoves)
    foldMovedImages(imageMoves)
  }
  const wrote = window.branchlog.layout.commitSync({ tasks: taskMoves, images: imageMoves })
  if (!wrote.ok) useNotebook.setState({ error: 'Could not save that position.' })
}
