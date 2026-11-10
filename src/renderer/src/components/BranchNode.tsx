import { memo, useEffect, useRef } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { BRANCH_LINE_HEIGHT, BRANCH_MIN_WIDTH } from '@shared/branch-size'
import { rememberCaret } from '../lib/caret'
import { useNotebook } from '../store/notebook'
import { tempCountRender } from '../temp-first-paint'
import { TaskBullet } from './TaskBullet'
import { BranchAi } from './BranchAi'

export const BranchNode = memo(function BranchNode({ id, selected }: NodeProps) {
  tempCountRender('BranchNode')
  const rootRef = useRef<HTMLDivElement>(null)
  const heightDrag = useRef(false)
  const task = useNotebook((state) => state.tasks.find((item) => item.id === id))
  const updateSize = useNotebook((state) => state.updateSize)

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
      const selectedText = window.getSelection()
      const range = selectedText && selectedText.rangeCount > 0 ? selectedText.getRangeAt(0) : null
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
      if (!keep || !selectedText || !range) return
      selectedText.removeAllRanges()
      selectedText.addRange(range)
    }
    root.addEventListener('pointerup', onPointerUp)
    return () => root.removeEventListener('pointerup', onPointerUp)
  }, [task?.id])

  if (!task) return null

  return (
    <div ref={rootRef} className="branch-node nopan">
      <NodeResizer
        isVisible={selected === true}
        minWidth={BRANCH_MIN_WIDTH}
        minHeight={BRANCH_LINE_HEIGHT}
        handleClassName="branch-resize-handle"
        lineClassName="branch-resize-line"
        onResize={(_event, params) => {
          if (params.direction[1] !== 0) heightDrag.current = true
        }}
        onResizeEnd={(_event, params) => {
          const content = rootRef.current?.offsetHeight ?? BRANCH_LINE_HEIGHT
          const height = heightDrag.current
            ? Math.max(Math.round(params.height), content, BRANCH_LINE_HEIGHT)
            : task.height
          heightDrag.current = false
          updateSize(id, params.x, params.y, Math.max(BRANCH_MIN_WIDTH, Math.round(params.width)), Math.round(height))
        }}
      />
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="branch-handle branch-handle-in"
      />
      <TaskBullet task={task} />
      <BranchAi taskId={id} />
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="branch-handle branch-handle-out"
      />
    </div>
  )
})
