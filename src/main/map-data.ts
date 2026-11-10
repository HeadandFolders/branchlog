import type { MapData, MapPosition, MapTask } from '@shared/types'
import { getDatabase } from './database'
import { deriveChainStates, type ChainRow } from './task-state'

interface MapRow extends ChainRow {
  text: string
  parentId: string | null
  orderIndex: number
  mapX: number | null
  mapY: number | null
}

const MAP_SQL = `SELECT t.id, t.text, t.dateCreated, t.dateCompleted, t.droppedAt, t.parentId,
    t.carriedFromId, t.chainId, t.orderIndex, mp.x AS mapX, mp.y AS mapY
  FROM tasks t LEFT JOIN mapPositions mp ON mp.taskId = t.id
  ORDER BY t.dateCreated, t.orderIndex, t.rowid`

const UPSERT_SQL = `INSERT INTO mapPositions (taskId, x, y) VALUES (?, ?, ?)
  ON CONFLICT(taskId) DO UPDATE SET x = excluded.x, y = excluded.y`

export function loadMapData(): MapData {
  const rows = getDatabase().prepare(MAP_SQL).all() as MapRow[]
  const tasks: MapTask[] = rows.map((row) => ({
    id: row.id,
    text: row.text,
    dateCreated: row.dateCreated,
    dateCompleted: row.dateCompleted,
    droppedAt: row.droppedAt,
    parentId: row.parentId,
    carriedFromId: row.carriedFromId,
    chainId: row.chainId,
    orderIndex: row.orderIndex,
    mapX: row.mapX,
    mapY: row.mapY,
  }))
  return { tasks, states: deriveChainStates(rows) }
}

export function saveMapPositions(points: readonly MapPosition[]): void {
  if (points.length === 0) return
  const db = getDatabase()
  const statement = db.prepare(UPSERT_SQL)
  db.transaction(() => {
    for (const point of points) statement.run(point.taskId, point.x, point.y)
  })()
}