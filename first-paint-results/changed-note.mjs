import Database from 'better-sqlite3'

const live = new Database('C:/Users/LENOVO - PC/AppData/Roaming/branchlog/branchlog.sqlite', {
  readonly: true,
  fileMustExist: true,
})
const backup = new Database(
  'C:/Users/LENOVO - PC/AppData/Roaming/branchlog/backups/branchlog-2026-11-08.sqlite',
  { readonly: true, fileMustExist: true },
)
const liveRows = live.prepare('SELECT id, dateCreated, text FROM tasks').all()
const backupRows = backup.prepare('SELECT id, dateCreated, text FROM tasks').all()
const liveById = new Map(liveRows.map((row) => [row.id, row]))
for (const row of backupRows) {
  const current = liveById.get(row.id)
  if (current && current.text !== row.text) {
    console.log('BACKUP', row.dateCreated, JSON.stringify(row.text.slice(0, 200)))
    console.log('LIVE  ', current.dateCreated, JSON.stringify(current.text.slice(0, 200)))
  }
}
live.close()
backup.close()
