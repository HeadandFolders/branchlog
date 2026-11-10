import type { ReactNode } from 'react'

interface TaskActionButtonProps {
  targetId: string
  action: string
  label: string
  className?: string
  disabled?: boolean
  onActivate: (targetId: string) => void
  children: ReactNode
}

export const TASK_ACTION_ICON = { size: 16, strokeWidth: 1.5 } as const

export function TaskActionButton({
  targetId,
  action,
  label,
  className,
  disabled,
  onActivate,
  children,
}: TaskActionButtonProps) {
  return (
    <button
      type="button"
      className={`task-action nodrag nopan${className ? ` ${className}` : ''}`}
      data-action={action}
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onActivate(targetId)
      }}
    >
      {children}
    </button>
  )
}
