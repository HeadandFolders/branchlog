import Database from 'better-sqlite3'
import { statSync } from 'node:fs'

const files = [
  'C:/Users/LENOVO - PC/AppData/Roaming/branchlog/branchlog.sqlite',
  'C:/Users/LENOVO - PC/AppData/Roaming/branchlog/backups/branchlog-2026-11-08.sqlite',
  'C:/Users/LENOVO - PC/AppData/Roaming/branchlog/backups/branchlog-2026-11-07.sqlite',
  'C:/Users/LENOVO - PC/Desktop/branchlog/userdata/branchlog.sqlite',
  'C:/Users/LENOVO - PC/Desktop/branchlog/userdata/backups/branchlog-2026-11-08.sqlite',
  'C:/Users/LENOVO - PC/Desktop/branchlog/first-paint-results/userdata/branchlog.sqlite',
]

for (const file of files) {
  const st = statSync(file)
  const db = new Database(file, { readonly: true, fileMustExist: true })
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name)
  let tasks = null
  let dates = null
  let sample = null
  if (tables.includes('tasks')) {
    tasks = db.prepare('SELECT COUNT(*) AS n FROM tasks').get()
    dates = db
      .prepare('SELECT dateCreated, COUNT(*) AS n FROM tasks GROUP BY dateCreated ORDER BY dateCreated')
      .all()
    sample = db
      .prepare(
        'SELECT dateCreated, substr(text, 1, 80) AS text FROM tasks ORDER BY dateCreated, orderIndex LIMIT 12',
      )
      .all()
  }
  console.log(
    JSON.stringify(
      { file, bytes: st.size, mtime: st.mtime.toISOString(), tables, tasks, dates, sample },
      null,
      2,
    ),
  )
  db.close()
}
