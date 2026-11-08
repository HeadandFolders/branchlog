import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const Database = createRequire(path.join(root, 'package.json'))('better-sqlite3')
const db = new Database('first-paint-results/userdata/branchlog.sqlite', { readonly: true, fileMustExist: true })
const today = new Date()
const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const q = `SELECT id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex
FROM tasks WHERE dateCreated = ?
ORDER BY CASE side WHEN 'main' THEN 0 ELSE 1 END, orderIndex ASC, rowid ASC`
console.log(JSON.stringify({
  today: key,
  plan: db.prepare(`EXPLAIN QUERY PLAN ${q}`).all(key),
  total: db.prepare('SELECT COUNT(*) AS n FROM tasks').get(),
  byDate: db.prepare('SELECT dateCreated, COUNT(*) AS n FROM tasks GROUP BY dateCreated ORDER BY dateCreated').all(),
  indexes: db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index'").all(),
}, null, 2))
db.close()
