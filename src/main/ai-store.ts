import type Database from 'better-sqlite3'
import type { Brief } from '@shared/ai-briefs'
import type { AiComment, AiCommentStatus, AiCommentType, AiReply, RemovedComments } from '@shared/ai-comments'
import type { ProjectCorrection } from '@shared/project-attribution'
import { getDatabase } from './database'

interface CommentRow {
  id: string
  taskId: string
  side: AiComment['side']
  type: AiCommentType
  text: string
  status: AiCommentStatus
  keptRanges: string
  x: number
  y: number
  createdAt: string
  projectId: string | null
  projectPinned: number
}

interface ReplyRow {
  id: string
  commentId: string
  role: 'user' | 'ai'
  text: string
  keptRanges: string
  createdAt: string
}

const COMMENT_COLUMNS =
  'id, taskId, side, type, text, status, keptRanges, x, y, createdAt, projectId, projectPinned'
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
    side: row.side,
    type: row.type,
    text: row.text,
    status: row.status,
    keptRanges: row.keptRanges,
    x: row.x,
    y: row.y,
    createdAt: row.createdAt,
    // Kept exactly as stored. A brief unlinked after the fact leaves the answer and its words alone;
    // the chip has nothing to name, and the prompt already stopped reading that file.
    projectId: row.projectId,
    projectPinned: row.projectPinned === 1,
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
      `SELECT COUNT(*) AS n FROM aiComments c JOIN tasks t ON t.id = c.taskId
       WHERE t.dateCreated = ? AND c.side = 'left'`,
    )
    .get(date) as { n: number }
  return row.n
}

const INSERT_COMMENT = `INSERT INTO aiComments (${COMMENT_COLUMNS})
  VALUES (@id, @taskId, @side, @type, @text, @status, @keptRanges, @x, @y, @createdAt, @projectId, @projectPinned)`
const INSERT_REPLY = `INSERT INTO aiReplies (${REPLY_COLUMNS})
  VALUES (@id, @commentId, @role, @text, @keptRanges, @createdAt)`

function insertOn(db: Database.Database, comment: AiComment): void {
  db.prepare(INSERT_COMMENT).run({
    id: comment.id,
    taskId: comment.taskId,
    side: comment.side,
    type: comment.type,
    text: comment.text,
    status: comment.status,
    keptRanges: comment.keptRanges,
    x: comment.x,
    y: comment.y,
    createdAt: comment.createdAt,
    projectId: comment.projectId,
    projectPinned: comment.projectPinned ? 1 : 0,
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

// The newest project the person chose themselves for this row, or null when they never chose. The
// choice of no project counts, which is why the id inside may be null.
export function latestProjectCorrection(taskId: string): ProjectCorrection | null {
  const row = getDatabase()
    .prepare('SELECT projectId FROM aiComments WHERE taskId = ? AND projectPinned = 1 ORDER BY createdAt DESC, rowid DESC LIMIT 1')
    .get(taskId) as { projectId: string | null } | undefined
  return row ? { projectId: row.projectId } : null
}

// Re-labelling a comment is a correction, so it pins: no later guess about this row overwrites it.
export function setCommentProject(commentId: string, projectId: string | null): AiComment {
  const db = getDatabase()
  // Only a brief that is still linked can be a label; anything else lands as no project.
  const resolved = projectId === null ? null : (getBrief(projectId)?.id ?? null)
  const result = db
    .prepare('UPDATE aiComments SET projectId = ?, projectPinned = 1 WHERE id = ?')
    .run(resolved, commentId)
  if (result.changes !== 1) throw new Error('Invalid comment')
  const comment = getComment(commentId)
  if (!comment) throw new Error('Invalid comment')
  return comment
}

export function setKeptRanges(commentId: string, replyId: string | null, keptRanges: string): AiComment {
  const db = getDatabase()
  const ranges = JSON.parse(keptRanges) as [number, number][]
  const row = replyId
    ? (db.prepare('SELECT text FROM aiReplies WHERE id = ? AND commentId = ?').get(replyId, commentId) as
        | { text: string }
        | undefined)
    : (db.prepare('SELECT text FROM aiComments WHERE id = ?').get(commentId) as { text: string } | undefined)
  if (!row) throw new Error('Invalid comment')
  for (const [, end] of ranges) {
    if (end > row.text.length) throw new Error('Invalid comment')
  }
  if (replyId) db.prepare('UPDATE aiReplies SET keptRanges = ? WHERE id = ?').run(keptRanges, replyId)
  else db.prepare('UPDATE aiComments SET keptRanges = ? WHERE id = ?').run(keptRanges, commentId)
  const comment = getComment(commentId)
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
       VALUES (@id, @taskId, @side, @type, @text, @status, @keptRanges, @x, @y, @createdAt, @projectId, @projectPinned)
       ON CONFLICT(id) DO UPDATE SET
         taskId = excluded.taskId,
         side = excluded.side,
         type = excluded.type,
         text = excluded.text,
         status = excluded.status,
         keptRanges = excluded.keptRanges,
         x = excluded.x,
         y = excluded.y,
         projectId = excluded.projectId,
         projectPinned = excluded.projectPinned`,
    )
    const insertReply = db.prepare(INSERT_REPLY)
    for (const comment of comments) {
      upsert.run({
        id: comment.id,
        taskId: comment.taskId,
        side: comment.side,
        type: comment.type,
        text: comment.text,
        status: comment.status,
        keptRanges: comment.keptRanges,
        x: comment.x,
        y: comment.y,
        createdAt: comment.createdAt,
        projectId: comment.projectId,
        projectPinned: comment.projectPinned ? 1 : 0,
      })
      db.prepare('DELETE FROM aiReplies WHERE commentId = ?').run(comment.id)
      for (const item of comment.replies) insertReply.run(item)
    }
  })()
}

interface BriefRow {
  id: string
  name: string
  filePath: string
  summary: string
  contentHash: string
  mtimeMs: number
  enabled: number
  alwaysInclude: number
  createdAt: string
  updatedAt: string
}

const BRIEF_COLUMNS =
  'id, name, filePath, summary, contentHash, mtimeMs, enabled, alwaysInclude, createdAt, updatedAt'

function mapBrief(row: BriefRow): Brief {
  return {
    id: row.id,
    name: row.name,
    filePath: row.filePath,
    summary: row.summary,
    contentHash: row.contentHash,
    mtimeMs: row.mtimeMs,
    enabled: row.enabled === 1,
    alwaysInclude: row.alwaysInclude === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// Name order is the stable prefix the assembled prompt depends on, so it is decided here once.
function queryBriefs(where: string, params: unknown[]): Brief[] {
  const rows = getDatabase()
    .prepare(`SELECT ${BRIEF_COLUMNS} FROM aiBriefs ${where} ORDER BY name, id`)
    .all(...params) as BriefRow[]
  return rows.map(mapBrief)
}

export function listBriefs(): Brief[] {
  return queryBriefs('', [])
}

export function listIncludedBriefs(): Brief[] {
  return queryBriefs('WHERE enabled = 1 AND alwaysInclude = 1', [])
}

export function getBrief(id: string): Brief | null {
  const row = getDatabase().prepare(`SELECT ${BRIEF_COLUMNS} FROM aiBriefs WHERE id = ?`).get(id) as
    | BriefRow
    | undefined
  return row ? mapBrief(row) : null
}

export function insertBrief(brief: Brief): void {
  getDatabase()
    .prepare(
      `INSERT INTO aiBriefs (${BRIEF_COLUMNS})
       VALUES (@id, @name, @filePath, @summary, @contentHash, @mtimeMs, @enabled, @alwaysInclude, @createdAt, @updatedAt)`,
    )
    .run({
      ...brief,
      enabled: brief.enabled ? 1 : 0,
      alwaysInclude: brief.alwaysInclude ? 1 : 0,
    })
}

export function writeBriefRead(
  id: string,
  read: { summary: string; contentHash: string; mtimeMs: number; updatedAt: string },
): Brief {
  const db = getDatabase()
  const result = db
    .prepare(
      `UPDATE aiBriefs
       SET summary = @summary, contentHash = @contentHash, mtimeMs = @mtimeMs, updatedAt = @updatedAt
       WHERE id = @id`,
    )
    .run({ id, ...read })
  if (result.changes !== 1) throw new Error('Invalid brief')
  return requireBrief(id)
}

export function setBriefEnabled(id: string, on: boolean): Brief {
  const db = getDatabase()
  const result = db
    .prepare('UPDATE aiBriefs SET enabled = ?, updatedAt = ? WHERE id = ?')
    .run(on ? 1 : 0, new Date().toISOString(), id)
  if (result.changes !== 1) throw new Error('Invalid brief')
  return requireBrief(id)
}

export function setBriefAlwaysInclude(id: string, on: boolean): Brief {
  const db = getDatabase()
  const result = db
    .prepare('UPDATE aiBriefs SET alwaysInclude = ?, updatedAt = ? WHERE id = ?')
    .run(on ? 1 : 0, new Date().toISOString(), id)
  if (result.changes !== 1) throw new Error('Invalid brief')
  return requireBrief(id)
}

function requireBrief(id: string): Brief {
  const brief = getBrief(id)
  if (!brief) throw new Error('Invalid brief')
  return brief
}

export function deleteBrief(id: string): void {
  const result = getDatabase().prepare('DELETE FROM aiBriefs WHERE id = ?').run(id)
  if (result.changes !== 1) throw new Error('Invalid brief')
}
