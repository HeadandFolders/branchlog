import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
const root = path.resolve('..')
const stage = path.join(root, 'first-paint-results', 'stage')
const dest = path.join(root, 'release-measure', 'Branchlog', 'resources')
mkdirSync(dest, { recursive: true })
const asar = path.join(dest, 'app.asar')
console.log('stage', existsSync(stage), 'npx', process.env.PATH?.includes('nodejs'))
const packed = spawnSync(
  'cmd.exe',
  ['/d', '/s', '/c', `npx --yes @electron/asar pack "${stage}" "${asar}" --unpack "*.node"`],
  { cwd: root, encoding: 'utf8', timeout: 180000 },
)
console.log(JSON.stringify({
  status: packed.status,
  error: packed.error ? String(packed.error) : null,
  stdout: packed.stdout?.slice(0, 2000),
  stderr: packed.stderr?.slice(0, 2000),
  asar: existsSync(asar),
}, null, 2))
