import { BRANCH_WIDTH } from '@shared/branch-size'
import { localDateKey } from '@shared/dates'
import type { Continuation, CreateContinuationInput, EarlierTask, Task } from '@shared/types'
import { getDatabase } from './database'

interface EarlierRow {
  id: string
  text: string
  dateCreated: string
  done: number
}

interface ContinuationRow {
  taskId: string
  parentId: string
  parentText: string
  parentDate: string
}

function isConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT')
  )
}

function likePattern(query: string): string | null {
  const trimmed = query.trim()
  if (trimmed === '') return null
  return `%${trimmed.replace(/[!%_]/g, (char) => `!${char}`)}%`
}

export function createContinuation(input: CreateContinuationInput): { task: Task; continuation: Continuation } {
  const db = getDatabase()
  const insert = db.transaction((branch: CreateContinuationInput) => {
    const today = localDateKey()
    const parent = db
      .prepare(`SELECT id, text, dateCreated FROM tasks WHERE id = ?`)
      .get(branch.parentId) as { id: string; text: string; dateCreated: string } | undefined
    if (!parent || parent.id === branch.id || parent.dateCreated >= today) throw new Error('Invalid task')

    const row = db
      .prepare(
        `SELECT COALESCE(MAX(orderIndex), -1) AS maxIndex
         FROM tasks WHERE dateCreated = ? AND side = 'main'`,
      )
      .get(today) as { maxIndex: number }
    const orderIndex = row.maxIndex + 1

    db.prepare(
      `INSERT INTO tasks (
         id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex
       ) VALUES (?, ?, 0, ?, NULL, ?, 0, 0, ?, 0, 'main', ?)`,
    ).run(branch.id, branch.text, today, parent.id, BRANCH_WIDTH, orderIndex)

    const task: Task = {
      id: branch.id,
      text: branch.text,
      done: false,
      dateCreated: today,
      dateCompleted: null,
      parentId: parent.id,
      x: 0,
      y: 0,
      width: BRANCH_WIDTH,
      height: 0,
      side: 'main',
      orderIndex,
    }
    const continuation: Continuation = {
      taskId: task.id,
      parentId: parent.id,
      parentText: parent.text,
      parentDate: parent.dateCreated,
    }
    return { task, continuation }
  })

  try {
    return insert(input)
  } catch (error) {
    if (isConstraint(error)) throw new Error('Invalid task')
    throw error
  }
}

export function listContinuations(dateCreated: string): Continuation[] {
  const rows = getDatabase()
    .prepare(
      `SELECT child.id AS taskId,
              parent.id AS parentId,
              parent.text AS parentText,
              parent.dateCreated AS parentDate
       FROM tasks AS child
       JOIN tasks AS parent ON parent.id = child.parentId
       WHERE child.dateCreated = ?
         AND parent.dateCreated <> child.dateCreated
       ORDER BY child.orderIndex ASC, child.rowid ASC`,
    )
    .all(dateCreated) as ContinuationRow[]
  return rows
}

export function searchEarlierTasks(query: string): EarlierTask[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, text, dateCreated, done
       FROM tasks
       WHERE dateCreated < @today
         AND (@pattern IS NULL OR text LIKE @pattern ESCAPE '!')
       ORDER BY dateCreated DESC,
                CASE side WHEN 'main' THEN 0 ELSE 1 END,
                orderIndex ASC
       LIMIT 40`,
    )
    .all({ today: localDateKey(), pattern: likePattern(query) }) as EarlierRow[]
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    dateCreated: row.dateCreated,
    done: row.done === 1,
  }))
}
