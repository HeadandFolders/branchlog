import { mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { localDateKey } from '@shared/dates'
import { getDatabase } from './database'

const BACKUP_NAME = /^branchlog-\d{4}-\d{2}-\d{2}\.sqlite$/
const KEEP = 7

let pending: Promise<void> = Promise.resolve()

export function startDailyBackup(): void {
  pending = backupDatabase().catch((error: unknown) => {
    console.error('Daily backup failed', error)
  })
}

export async function finishBackup(): Promise<void> {
  await pending
}

async function backupDatabase(): Promise<void> {
  const database = getDatabase()
  const dir = path.join(app.getPath('userData'), 'backups')
  mkdirSync(dir, { recursive: true })
  const destination = path.join(dir, `branchlog-${localDateKey()}.sqlite`)
  if (!existsSync(destination)) {
    await database.backup(destination)
  }
  const names = readdirSync(dir)
    .filter((name) => BACKUP_NAME.test(name))
    .sort()
  const extras = names.slice(0, Math.max(0, names.length - KEEP))
  for (const name of extras) {
    rmSync(path.join(dir, name), { force: true })
  }
}
