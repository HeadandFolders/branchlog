import type Database from 'better-sqlite3'
import type { AiComment, AiCommentStatus, AiCommentType, AiReply, RemovedComments } from '@shared/ai-comments'
import { getDatabase } from './database'

interface CommentRow {
  id: string
  taskId: string
  side: 'left'
  type: AiCommentType
  text: string
  status: AiCommentStatus
  keptRanges: string
  x: number
  y: number
  createdAt: string
}

interface ReplyRow {
  id: string
  commentId: string
  role: 'user' | 'ai'
  text: string
  keptRanges: string
  createdAt: string
}

const COMMENT_COLUMNS = 'id, taskId, side, type, text, status, keptRanges, x, y, createdAt'
const REPLY_COLUMNS = 'id, commentId, role, text, keptRanges, createdAt'

function mapReply(row: ReplyRow): AiReply {
  return {
    id: row.id,
    commentId: row.commentId,
    role: row.role,
    text: row.text,
    keptRanges: row.keptRanges,
    createdAt: row.createdAt,
  }
}

function mapComment(row: CommentRow, replies: AiReply[]): AiComment {
  return {
    id: row.id,
    taskId: row.taskId,
    side: 'left',
    type: row.type,
    text: row.text,
    status: row.status,
    keptRanges: row.keptRanges,
    x: row.x,
    y: row.y,
    createdAt: row.createdAt,
    replies,
  }
}

function repliesByComment(db: Database.Database, commentIds: string[]): Map<string, AiReply[]> {
  const grouped = new Map<string, AiReply[]>()
  if (commentIds.length === 0) return grouped
  const marks = commentIds.map(() => '?').join(', ')
  const rows = db
    .prepare(`SELECT ${REPLY_COLUMNS} FROM aiReplies WHERE commentId IN (${marks}) ORDER BY createdAt, rowid`)
    .all(...commentIds) as ReplyRow[]
  for (const row of rows) {
    const list = grouped.get(row.commentId) ?? []
    list.push(mapReply(row))
    grouped.set(row.commentId, list)
  }
  return grouped
}

function withReplies(db: Database.Database, rows: CommentRow[]): AiComment[] {
  const grouped = repliesByComment(db, rows.map((row) => row.id))
  return rows.map((row) => mapComment(row, grouped.get(row.id) ?? []))
}

export function listCommentsByDate(date: string): AiComment[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT ${COMMENT_COLUMNS.split(', ').map((column) => `c.${column}`).join(', ')}
       FROM aiComments c JOIN tasks t ON t.id = c.taskId
       WHERE t.dateCreated = ?
       ORDER BY c.createdAt, c.rowid`,
    )
    .all(date) as CommentRow[]
  return withReplies(db, rows)
}

export function listCommentsForTasks(db: Database.Database, taskIds: string[]): AiComment[] {
  if (taskIds.length === 0) return []
  const marks = taskIds.map(() => '?').join(', ')
  const rows = db
    .prepare(`SELECT ${COMMENT_COLUMNS} FROM aiComments WHERE taskId IN (${marks}) ORDER BY createdAt, rowid`)
    .all(...taskIds) as CommentRow[]
  return withReplies(db, rows)
}

export function getComment(id: string): AiComment | null {
  const db = getDatabase()
  const row = db.prepare(`SELECT ${COMMENT_COLUMNS} FROM aiComments WHERE id = ?`).get(id) as CommentRow | undefined
  if (!row) return null
  return mapComment(row, repliesByComment(db, [id]).get(id) ?? [])
}

export function countCommentsOn(date: string): number {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS n FROM aiComments c JOIN tasks t ON t.id = c.taskId WHERE t.dateCreated = ?`,
    )
    .get(date) as { n: number }
  return row.n
}

const INSERT_COMMENT = `INSERT INTO aiComments (${COMMENT_COLUMNS})
  VALUES (@id, @taskId, 'left', @type, @text, @status, @keptRanges, @x, @y, @createdAt)`
const INSERT_REPLY = `INSERT INTO aiReplies (${REPLY_COLUMNS})
  VALUES (@id, @commentId, @role, @text, @keptRanges, @createdAt)`

function insertOn(db: Database.Database, comment: AiComment): void {
  db.prepare(INSERT_COMMENT).run({
    id: comment.id,
    taskId: comment.taskId,
    type: comment.type,
    text: comment.text,
    status: comment.status,
    keptRanges: comment.keptRanges,
    x: comment.x,
    y: comment.y,
    createdAt: comment.createdAt,
  })
  const reply = db.prepare(INSERT_REPLY)
  for (const item of comment.replies) reply.run(item)
}

export function insertComment(comment: AiComment): void {
  const db = getDatabase()
  db.transaction(() => insertOn(db, comment))()
}

export function addReplies(commentId: string, replies: AiReply[]): void {
  const db = getDatabase()
  db.transaction(() => {
    const exists = db.prepare('SELECT 1 AS ok FROM aiComments WHERE id = ?').get(commentId)
    if (!exists) throw new Error('Invalid comment')
    const reply = db.prepare(INSERT_REPLY)
    for (const item of replies) {
      if (item.commentId !== commentId) throw new Error('Invalid comment')
      reply.run(item)
    }
  })()
}

export function setCommentStatus(id: string, status: AiCommentStatus): AiComment {
  const db = getDatabase()
  const result = db.prepare('UPDATE aiComments SET status = ? WHERE id = ?').run(status, id)
  if (result.changes !== 1) throw new Error('Invalid comment')
  const comment = getComment(id)
  if (!comment) throw new Error('Invalid comment')
  return comment
}

export function removeComment(id: string): RemovedComments {
  const db = getDatabase()
  return db.transaction(() => {
    const row = db.prepare(`SELECT ${COMMENT_COLUMNS} FROM aiComments WHERE id = ?`).get(id) as CommentRow | undefined
    if (!row) throw new Error('Invalid comment')
    const comment = mapComment(row, repliesByComment(db, [id]).get(id) ?? [])
    db.prepare('DELETE FROM aiComments WHERE id = ?').run(id)
    return { comments: [comment] }
  })()
}

export function restoreCommentsOn(db: Database.Database, removed: RemovedComments): void {
  for (const comment of removed.comments) insertOn(db, comment)
}

export function replaceComments(date: string, comments: AiComment[]): void {
  const db = getDatabase()
  db.transaction(() => {
    for (const comment of comments) {
      const task = db.prepare('SELECT dateCreated FROM tasks WHERE id = ?').get(comment.taskId) as
        | { dateCreated: string }
        | undefined
      if (!task || task.dateCreated !== date) throw new Error('Invalid comment')
    }
    const existing = db
      .prepare(
        `SELECT c.id FROM aiComments c JOIN tasks t ON t.id = c.taskId WHERE t.dateCreated = ?`,
      )
      .all(date) as { id: string }[]
    const keep = new Set(comments.map((comment) => comment.id))
    for (const row of existing) {
      if (!keep.has(row.id)) db.prepare('DELETE FROM aiComments WHERE id = ?').run(row.id)
    }
    const upsert = db.prepare(
      `INSERT INTO aiComments (${COMMENT_COLUMNS})
       VALUES (@id, @taskId, 'left', @type, @text, @status, @keptRanges, @x, @y, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         taskId = excluded.taskId,
         type = excluded.type,
         text = excluded.text,
         status = excluded.status,
         keptRanges = excluded.keptRanges,
         x = excluded.x,
         y = excluded.y`,
    )
    const insertReply = db.prepare(INSERT_REPLY)
    for (const comment of comments) {
      upsert.run({
        id: comment.id,
        taskId: comment.taskId,
        type: comment.type,
        text: comment.text,
        status: comment.status,
        keptRanges: comment.keptRanges,
        x: comment.x,
        y: comment.y,
        createdAt: comment.createdAt,
      })
      db.prepare('DELETE FROM aiReplies WHERE commentId = ?').run(comment.id)
      for (const item of comment.replies) insertReply.run(item)
    }
  })()
}