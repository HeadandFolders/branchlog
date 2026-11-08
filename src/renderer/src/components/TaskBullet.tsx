import {
  memo,
  useLayoutEffect,
  useRef,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react'
import { Handle, Position } from '@xyflow/react'
import { Check } from 'lucide-react'
import type { Task } from '@shared/types'
import { branchFromTask, branchShortcutLabel } from '../lib/branch-from'
import { caretOffsets, insertPlainText } from '../lib/caret'
import { useTaskFieldFocus } from '../lib/field-focus'
import { textDirection } from '../lib/direction'
import { handleTaskBeforeInput, handleTaskKey } from '../lib/task-keys'
import { batchEdits, markInput } from '../store/history'
import { useNotebook } from '../store/notebook'
import { tempCountRender } from '../temp-first-paint'

interface BulletTextProps {
  textRef: RefObject<HTMLDivElement | null>
  taskId: string
  text: string
  done: boolean
  editing: boolean
  onFocus: () => void
  onInput: (text: string) => void
  onBlur: () => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onBeforeInput: (event: FormEvent<HTMLDivElement>) => void
  onPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void
}

const BulletText = memo(
  function BulletText({
    textRef,
    taskId,
    text,
    done,
    editing,
    onFocus,
    onInput,
    onBlur,
    onKeyDown,
    onBeforeInput,
    onPaste,
  }: BulletTextProps) {
    useLayoutEffect(() => {
      const element = textRef.current
      if (!element || editing || element.textContent === text) return
      const selection = window.getSelection()
      if (
        selection &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed &&
        element.contains(selection.anchorNode) &&
        element.contains(selection.focusNode)
      ) {
        return
      }
      element.textContent = text
    }, [editing, text, textRef])

    const textClass = done
      ? 'text-[var(--text-muted)] line-through decoration-[var(--text-muted)]'
      : 'text-[var(--text)]'

    return (
      <div
        ref={textRef}
        data-task-text=""
        data-task-id={taskId}
        role="textbox"
        aria-label="Task"
        aria-multiline="true"
        spellCheck={editing}
        dir={textDirection(text)}
        tabIndex={0}
        contentEditable={editing ? 'plaintext-only' : 'false'}
        suppressContentEditableWarning
        className={`bullet-text nopan nodrag ${textClass}`}
        onFocus={onFocus}
        onPointerDown={(event) => {
          if (event.button !== 2) return
          event.currentTarget.contentEditable = 'plaintext-only'
          event.currentTarget.spellcheck = true
          onFocus()
        }}
        onInput={(event) => {
          const value = event.currentTarget.textContent ?? ''
          const direction = textDirection(value)
          if (event.currentTarget.dir !== direction) event.currentTarget.dir = direction
          const native = event.nativeEvent
          markInput(native instanceof InputEvent ? native.inputType : '')
          onInput(value)
        }}
        onBlur={onBlur}
        onBeforeInput={onBeforeInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
    )
  },
  (prev, next) => {
    if (prev.taskId !== next.taskId || prev.editing !== next.editing || prev.done !== next.done) return false
    if (!next.editing && prev.text !== next.text) return false
    return true
  },
)

interface TaskBulletProps {
  task: Task
}

export function TaskBullet({ task }: TaskBulletProps) {
  tempCountRender('TaskBullet')
  const ref = useRef<HTMLDivElement>(null)
  const updateText = useNotebook((state) => state.updateText)
  const flushText = useNotebook((state) => state.flushText)
  const toggleDone = useNotebook((state) => state.toggleDone)
  const createTask = useNotebook((state) => state.createTask)
  const createBranch = useNotebook((state) => state.createBranch)
  const setFocusedId = useNotebook((state) => state.setFocusedId)
  const editing = useNotebook((state) => state.focusedId === task.id)
  const splitLock = useRef(false)
  useTaskFieldFocus(ref, task.id, editing)

  const splitAtCaret = (element: HTMLDivElement): void => {
    batchEdits(() => {
    const text = element.textContent ?? ''
    const { start, end } = caretOffsets(element)
    let before = text.slice(0, start)
    let after = text.slice(end)
    if (start === end) {
      if (before.endsWith('\r\n')) before = before.slice(0, -2)
      else if (before.endsWith('\n') || before.endsWith('\r')) before = before.slice(0, -1)
      else if (after.startsWith('\r\n')) after = after.slice(2)
      else if (after.startsWith('\n') || after.startsWith('\r')) after = after.slice(1)
    }
    if (task.side === 'right' && !task.parentId) return
    if (element.textContent !== before) element.textContent = before
    updateText(task.id, before)
    if (task.side === 'right') {
      if (!task.parentId) return
      createBranch(task.parentId, task.x, task.y + 72, after, true)
      return
    }
    createTask(task.id, after, true)
    })
  }

  const branchFrom = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    branchFromTask(task.id)
  }

  return (
    <div
      className={`task-line nopan relative flex items-start gap-3 rounded-[3px] px-2 py-1.5 ${
        editing ? 'bg-[var(--bg-subtle)]' : ''
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? 'Mark task not done' : 'Mark task done'}
        className="task-check nopan flex items-center justify-center"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void toggleDone(task.id)}
      >
        {task.done ? <Check size={12} strokeWidth={2.5} /> : null}
      </button>
      <div className="relative min-w-0 flex-1">
        {task.text === '' ? (
          <span className="task-placeholder" aria-hidden="true">
            Write a task
          </span>
        ) : null}
        <BulletText
          textRef={ref}
          taskId={task.id}
          text={task.text}
          done={task.done}
          editing={editing}
          onFocus={() => setFocusedId(task.id)}
          onInput={(text) => updateText(task.id, text)}
          onBlur={() => void flushText(task.id)}
          onPaste={(event) => {
            if ('isComposing' in event.nativeEvent && event.nativeEvent.isComposing) return
            const data = event.clipboardData
            const plain = data?.getData('text/plain') ?? ''
            const html = plain === '' ? (data?.getData('text/html') ?? '') : ''
            const text =
              plain !== ''
                ? plain
                : html === ''
                  ? ''
                  : (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '')
            if (text === '') return
            event.preventDefault()
            event.stopPropagation()
            const next = insertPlainText(event.currentTarget, text)
            event.currentTarget.dir = textDirection(next)
            updateText(task.id, next)
          }}
          onBeforeInput={(event) => handleTaskBeforeInput(event, splitLock, splitAtCaret)}
          onKeyDown={(event) => handleTaskKey(event, task, splitLock, splitAtCaret)}
        />
      </div>
      <button
        type="button"
        className="branch-dot nopan nodrag"
        aria-label="Branch from this task"
        title={branchShortcutLabel()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={branchFrom}
      />
      {task.side === 'main' ? (
        <Handle
          id={`out-${task.id}`}
          type="source"
          position={Position.Right}
          isConnectable={false}
          className="branch-handle"
          style={{ top: 19, width: 1, height: 1, minWidth: 0, minHeight: 0, opacity: 0, border: 'none', background: 'transparent' }}
        />
      ) : null}
    </div>
  )
}
