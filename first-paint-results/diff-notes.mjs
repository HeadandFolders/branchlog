import Database from 'better-sqlite3'

const live = new Database('C:/Users/LENOVO - PC/AppData/Roaming/branchlog/branchlog.sqlite', {
  readonly: true,
  fileMustExist: true,
})
const backup = new Database(
  'C:/Users/LENOVO - PC/AppData/Roaming/branchlog/backups/branchlog-2026-11-08.sqlite',
  { readonly: true, fileMustExist: true },
)

const cols = live.prepare('PRAGMA table_info(tasks)').all()
console.log('columns', cols.map((col) => col.name).join(', '))

const liveRows = live.prepare('SELECT id, dateCreated, substr(text, 1, 120) AS text FROM tasks').all()
const backupRows = backup
  .prepare('SELECT id, dateCreated, substr(text, 1, 120) AS text FROM tasks')
  .all()
const liveById = new Map(liveRows.map((row) => [row.id, row]))
const backupById = new Map(backupRows.map((row) => [row.id, row]))

const onlyBackup = backupRows.filter((row) => !liveById.has(row.id))
const onlyLive = liveRows.filter((row) => !backupById.has(row.id))
const moved = backupRows.filter((row) => {
  const current = liveById.get(row.id)
  return current && current.dateCreated !== row.dateCreated
})
const textChanged = backupRows.filter((row) => {
  const current = liveById.get(row.id)
  return current && current.text !== row.text && current.dateCreated === row.dateCreated
})

console.log(
  JSON.stringify(
    {
      live: liveRows.length,
      backup: backupRows.length,
      onlyBackup: onlyBackup.map(({ dateCreated, text }) => ({ dateCreated, text })),
      onlyLive: onlyLive.map(({ dateCreated, text }) => ({ dateCreated, text })),
      moved: moved.map((row) => ({
        from: row.dateCreated,
        to: liveById.get(row.id).dateCreated,
        text: row.text,
      })),
      textChanged: textChanged.length,
    },
    null,
    2,
  ),
)
live.close()
backup.close()
