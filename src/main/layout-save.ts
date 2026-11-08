import type { LayoutCommit } from '@shared/types'
import { getDatabase } from './database'

export function commitLayout(input: LayoutCommit): void {
  const db = getDatabase()
  const task = db.prepare(`UPDATE tasks SET x = ?, y = ? WHERE id = ?`)
  const image = db.prepare(`UPDATE images SET x = ?, y = ? WHERE id = ?`)
  const run = db.transaction((commit: LayoutCommit) => {
    for (const point of commit.tasks) {
      const result = task.run(point.x, point.y, point.id)
      if (result.changes !== 1) throw new Error('Invalid task')
    }
    for (const point of commit.images) {
      const result = image.run(point.x, point.y, point.id)
      if (result.changes !== 1) throw new Error('Invalid image')
    }
  })
  run(input)
}
