import { useEffect, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { rememberCaret } from '../lib/caret'
import { useNotebook } from '../store/notebook'
import { TaskBullet } from './TaskBullet'

export function BranchNode({ id }: NodeProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const task = useNotebook((state) => state.tasks.find((item) => item.id === id))
  const deleteTask = useNotebook((state) => state.deleteTask)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onPointerUp = (event: PointerEvent): void => {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Element)) return
      const text = target.closest<HTMLElement>('[data-task-text]')
      if (!text || !root.contains(text)) return
      const taskId = text.dataset.taskId
      if (!taskId) return
      const notebook = useNotebook.getState()
      if (notebook.focusedId === taskId && document.activeElement === text) return
      const selected = window.getSelection()
      const range = selected && selected.rangeCount > 0 ? selected.getRangeAt(0) : null
      const keep =
        range !== null &&
        !range.collapsed &&
        text.contains(range.startContainer) &&
        text.contains(range.endContainer)
      if (notebook.focusedId !== taskId) {
        if (!keep) rememberCaret({ id: taskId, x: event.clientX, y: event.clientY })
        notebook.setFocusedId(taskId)
        return
      }
      text.focus({ preventScroll: true })
      if (!keep || !selected || !range) return
      selected.removeAllRanges()
      selected.addRange(range)
    }
    root.addEventListener('pointerup', onPointerUp)
    return () => root.removeEventListener('pointerup', onPointerUp)
  }, [task?.id])

  if (!task) return null

  return (
    <div ref={rootRef} className="branch-node nopan">
      <Handle
        id="out"
        type="source"
        position={Position.Left}
        isConnectable={false}
        className="branch-handle"
        style={{ width: 1, height: 1, minWidth: 0, minHeight: 0, opacity: 0, border: 'none', background: 'transparent' }}
      />
      <TaskBullet task={task} />
      <button
        type="button"
        className="branch-delete nopan nodrag"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation()
          void deleteTask(task.id)
        }}
      >
        Delete
      </button>
      <Handle
        id="in"
        type="target"
        position={Position.Right}
        isConnectable={false}
        className="branch-handle"
        style={{ width: 1, height: 1, minWidth: 0, minHeight: 0, opacity: 0, border: 'none', background: 'transparent' }}
      />
    </div>
  )
}
