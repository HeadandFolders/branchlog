import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] ?? 'prod'
const trace = path.resolve(`trace-${mode}.json`)
const userData = path.resolve('userdata')
const logFile = path.resolve(`trace-${mode}.log`)
rmSync(trace, { force: true })
rmSync(logFile, { force: true })
const extra = ['--trace-startup', `--trace-startup-file=${trace}`, '--trace-startup-duration=10']
const env = {
  ...process.env,
  BRANCHLOG_USER_DATA: userData,
  BRANCHLOG_MEASURE: '1',
  BRANCHLOG_MEASURE_LOG: logFile,
}
delete env.ELECTRON_RENDERER_URL
let command
let args
let cwd = root
if (mode === 'dev') {
  command = 'npm.cmd'
  args = ['run', 'dev', '--', ...extra]
} else if (mode === 'prod') {
  command = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  args = [root, ...extra]
} else {
  command = path.join(root, 'release-measure-2', 'Branchlog', 'Branchlog.exe')
  args = extra
  cwd = path.dirname(command)
}
console.log('root', root)
console.log('command', command)
const child = spawn(command, args, { cwd, env, shell: mode === 'dev', stdio: 'inherit' })
child.on('exit', (code) => console.log('child exit', code))
child.on('error', (error) => console.log('child error', error.message))
const started = Date.now()
while (Date.now() - started < 60000) {
  if (existsSync(logFile) && readFileSync(logFile, 'utf8').includes('"label":"measure-done"')) break
  if (child.exitCode !== null) break
  await new Promise((resolve) => setTimeout(resolve, 200))
}
const exitWait = Date.now()
while (child.exitCode === null && Date.now() - exitWait < 8000) {
  await new Promise((resolve) => setTimeout(resolve, 200))
}
if (child.exitCode === null && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
await new Promise((resolve) => setTimeout(resolve, 500))
if (!existsSync(trace)) {
  console.log('trace missing')
  process.exit(0)
}
const parsed = JSON.parse(readFileSync(trace, 'utf8'))
const events = Array.isArray(parsed) ? parsed : parsed.traceEvents ?? []
const threads = new Map()
for (const event of events) {
  if (event.ph === 'M' && event.name === 'thread_name') threads.set(`${event.pid}:${event.tid}`, event.args?.name)
}
const renderer = new Set(
  [...threads.entries()].filter(([, name]) => name === 'CrRendererMain').map(([key]) => key),
)
const long = []
for (const event of events) {
  if (event.ph !== 'X' || event.dur < 50000) continue
  if (!renderer.has(`${event.pid}:${event.tid}`)) continue
  const data = event.args?.data ?? {}
  long.push({
    name: event.name,
    ms: Math.round(event.dur / 1000),
    fn: data.functionName || '',
    url: typeof data.url === 'string' ? data.url.slice(-120) : '',
    ts: event.ts,
  })
}
long.sort((a, b) => b.ms - a.ms)
console.log(JSON.stringify({
  bytes: statSync(trace).size,
  events: events.length,
  threads: [...new Set(threads.values())].slice(0, 30),
  long: long.slice(0, 40),
}, null, 2))
