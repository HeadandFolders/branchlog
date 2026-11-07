import { memo, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { Check } from 'lucide-react'
import type { Task } from '@shared/types'
import { caretOffsets, placeCaret, takeCaret } from '../lib/caret'
import { useNotebook } from '../store/notebook'

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
  }: BulletTextProps) {
    useLayoutEffect(() => {
      const element = textRef.current
      if (!element || element.textContent === text) return
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
        aria-multiline="false"
        spellCheck={editing}
        contentEditable={editing ? 'plaintext-only' : 'false'}
        suppressContentEditableWarning
        className={`bullet-text nopan nodrag ${textClass}`}
        onFocus={onFocus}
        onInput={(event) => onInput(event.currentTarget.textContent ?? '')}
        onBlur={onBlur}
        onBeforeInput={onBeforeInput}
        onKeyDown={onKeyDown}
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
  const ref = useRef<HTMLDivElement>(null)
  const updateText = useNotebook((state) => state.updateText)
  const flushText = useNotebook((state) => state.flushText)
  const toggleDone = useNotebook((state) => state.toggleDone)
  const deleteTask = useNotebook((state) => state.deleteTask)
  const createTask = useNotebook((state) => state.createTask)
  const setFocusedId = useNotebook((state) => state.setFocusedId)
  const editing = useNotebook((state) => state.focusedId === task.id)
  const clearFocusRequest = useNotebook((state) => state.clearFocusRequest)
  const splitLock = useRef(false)

  const splitAtCaret = (element: HTMLDivElement): void => {
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
    if (element.textContent !== before) element.textContent = before
    updateText(task.id, before)
    createTask(task.id, after, true)
  }

  useLayoutEffect(() => {
    if (!editing) return
    const element = ref.current
    if (!element) return
    const request = useNotebook.getState().focusRequest
    const pinned = request?.id === task.id && request.offset !== undefined
    if (document.activeElement === element && !pinned) return
    if (element.textContent !== task.text) element.textContent = task.text
    element.focus()
    const selection = window.getSelection()
    if (!selection) return
    if (pinned && request) {
      placeCaret(element, request.offset ?? 0)
    } else {
      const caret = takeCaret(task.id)
      const point = caret ? document.caretRangeFromPoint(caret.x, caret.y) : null
      if (point && element.contains(point.startContainer)) {
        selection.removeAllRanges()
        selection.addRange(point)
      } else {
        const range = document.createRange()
        range.selectNodeContents(element)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
    if (useNotebook.getState().focusRequest?.id === task.id) clearFocusRequest()
  }, [clearFocusRequest, editing, task.id, task.text])

  return (
    <div
      className={`nopan flex items-start gap-3 rounded-[3px] px-2 py-1.5 ${
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
          onBeforeInput={(event) => {
            const native = event.nativeEvent
            if (!(native instanceof InputEvent)) return
            if (native.inputType !== 'insertParagraph' && native.inputType !== 'insertLineBreak') return
            if (!splitLock.current && native.inputType === 'insertLineBreak') return
            event.preventDefault()
            if (splitLock.current) return
            splitAtCaret(event.currentTarget)
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              splitLock.current = true
              splitAtCaret(event.currentTarget)
              queueMicrotask(() => {
                splitLock.current = false
              })
              return
            }
            if (
              (event.key === 'Backspace' || event.key === 'Delete') &&
              (event.currentTarget.textContent ?? '') === '' &&
              !event.repeat &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey
            ) {
              event.preventDefault()
              void deleteTask(task.id)
            }
          }}
        />
      </div>
    </div>
  )
}
