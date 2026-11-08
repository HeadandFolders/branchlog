// TEMP first-paint measurement runner. Not part of the app.
import { spawn, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { cpus, totalmem } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = path.join(root, 'first-paint-results')
const userData = path.join(results, 'userdata')
const electronCli = path.join(root, 'node_modules', 'electron', 'cli.js')
const packagedExe = path.join(root, 'release-measure-2', 'Branchlog', 'Branchlog.exe')

const args = process.argv.slice(2)
const smoke = args.includes('--smoke')
const skipPackage = args.includes('--skip-package')
const modesArg = args.find((arg) => arg.startsWith('--modes='))
const runsArg = args.find((arg) => arg.startsWith('--runs='))
const modes = smoke ? ['prod'] : (modesArg?.slice('--modes='.length).split(',') ?? ['prod', 'packaged', 'dev'])
const runs = smoke ? 1 : Number(runsArg?.slice('--runs='.length) ?? 5)

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function walk(dir, acc = { files: 0, bytes: 0 }) {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else {
      acc.files += 1
      acc.bytes += statSync(full).size
    }
  }
  return acc
}

function seed() {
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(path.join(userData, 'backups'), { recursive: true })
  const today = localDateKey()
  writeFileSync(path.join(userData, 'backups', `branchlog-${today}.sqlite`), '')
  writeFileSync(
    path.join(userData, 'window-state.json'),
    JSON.stringify({ width: 1280, height: 800, x: 80, y: 60, isMaximized: false }),
  )
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
      dateCreated TEXT NOT NULL,
      dateCompleted TEXT,
      parentId TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      width REAL NOT NULL DEFAULT 240,
      height REAL NOT NULL DEFAULT 0,
      side TEXT NOT NULL DEFAULT 'main' CHECK (side IN ('main', 'right')),
      orderIndex INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_tasks_date ON tasks(dateCreated, side, orderIndex);
    CREATE INDEX idx_tasks_parent ON tasks(parentId);
    CREATE INDEX idx_tasks_completed ON tasks(dateCompleted);
    CREATE TABLE aiComments (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      side TEXT NOT NULL DEFAULT 'left' CHECK (side IN ('left')),
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      keptRanges TEXT NOT NULL DEFAULT '[]',
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE aiReplies (
      id TEXT PRIMARY KEY,
      commentId TEXT NOT NULL REFERENCES aiComments(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'ai')),
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE images (
      id TEXT PRIMARY KEY,
      dateKey TEXT NOT NULL,
      fileName TEXT NOT NULL,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      width REAL NOT NULL,
      height REAL NOT NULL
    );
    CREATE TABLE mapPositions (
      taskId TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      x REAL NOT NULL,
      y REAL NOT NULL
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings (key, value) VALUES ('orphanCleanup', '1');
  `)
  const insert = db.prepare(
    `INSERT INTO tasks (
      id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex
    ) VALUES (?, ?, 0, ?, NULL, ?, ?, ?, 240, 0, ?, ?)`,
  )
  const notes = [
    'Call the school about the Thursday pickup',
    'Draft the weekly note',
    'Buy milk, eggs, and bread',
    'Reply to the landlord',
    'Book the dentist',
    'Water the plants',
    'Send the invoice',
    'Read ten pages',
    'Put the washing on',
    'Walk before lunch',
    'Check the train time',
    'Write down what is left for tomorrow',
  ]
  const write = db.transaction(() => {
    notes.forEach((text, index) => {
      insert.run(`main-${index}`, text, today, null, 0, 0, 'main', index)
    })
    insert.run('branch-0', 'Ask about the late form', today, 'main-0', 760, 40, 'right', 0)
    insert.run('branch-1', 'Attach the receipt', today, 'main-6', 760, 280, 'right', 1)
    insert.run('branch-2', 'Keep it to one paragraph', today, 'main-1', 980, 90, 'right', 2)
    for (let index = 0; index < 40; index += 1) {
      const date = addDays(today, -1 - (index % 12))
      insert.run(`old-${index}`, `Older note ${index}`, date, null, 0, 0, 'main', index)
    }
  })
  write()
  const query = `SELECT id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex
    FROM tasks WHERE dateCreated = ? ORDER BY CASE side WHEN 'main' THEN 0 ELSE 1 END, orderIndex ASC, rowid ASC`
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(today)
  const total = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n
  const todayRows = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE dateCreated = ?').get(today).n
  const indexes = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL`).all()
  const samples = []
  for (let index = 0; index < 20; index += 1) {
    const start = performance.now()
    db.prepare(query).all(today)
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  db.close()
  return {
    today,
    totalRows: total,
    todayRows,
    otherRows: total - todayRows,
    plan,
    indexes,
    outsideQueryMedianMs: Math.round(samples[10] * 1000) / 1000,
  }
}

function parseLog(text) {
  const marks = []
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('TEMP_MARK ')
    if (index === -1) continue
    try {
      marks.push(JSON.parse(line.slice(index + 'TEMP_MARK '.length)))
    } catch {
      // ignore a torn line
    }
  }
  const seen = new Set()
  return marks.filter((mark) => {
    const key = `${mark.label}|${mark.now}|${mark.perf}|${mark.n ?? ''}|${mark.event ?? ''}|${mark.rank ?? ''}|${mark.family ?? ''}|${mark.name ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function first(marks, label) {
  return marks.find((mark) => mark.label === label)
}

function last(marks, label) {
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    if (marks[index].label === label) return marks[index]
  }
  return undefined
}

function summarize(marks) {
  const shown = first(marks, 'window-shown')
  const origin = first(marks, 'html-parse')?.origin ?? first(marks, 'js-eval-start')?.origin
  const rel = (mark) => (mark && shown ? Math.round(mark.now - shown.now) : null)
  const entry = (mark) =>
    mark && shown && origin != null && typeof mark.startTime === 'number'
      ? Math.round(origin + mark.startTime - shown.now)
      : null
  const main = first(marks, 'main-evaluated')
  return {
    fromShown: {
      htmlParse: rel(first(marks, 'html-parse')),
      didStartLoading: rel(first(marks, 'did-start-loading')),
      preloadStart: rel(first(marks, 'preload-start')),
      preloadEnd: rel(first(marks, 'preload-end')),
      domReady: rel(first(marks, 'dom-ready')),
      didFinishLoad: rel(first(marks, 'did-finish-load')),
      jsEval: rel(first(marks, 'js-eval-start')),
      reactRenderStart: rel(first(marks, 'react-render-start')),
      reactCommit: rel(first(marks, 'react-commit')),
      reactCommits: marks.filter((mark) => mark.label === 'react-commit').length,
      shellVisible: rel(first(marks, 'shell-visible')),
      ipcSend: rel(first(marks, 'ipc-send')),
      ipcRecv: rel(first(marks, 'ipc-recv')),
      storeCleared: rel(first(marks, 'store-cleared')),
      storeFilled: rel(first(marks, 'store-filled')),
      flowInit: rel(first(marks, 'react-flow-init')),
      flowInits: marks.filter((mark) => mark.label === 'react-flow-init').length,
      canvasRebuilds: marks.filter((mark) => mark.label === 'canvas-rebuild').length,
      flowMeasureEvents: marks.filter((mark) => mark.label === 'react-flow-measure').length,
      taskVisible: rel(first(marks, 'task-visible')),
      taskReady: rel(first(marks, 'task-ready-for-input')),
      fcp: entry(first(marks, 'fcp')),
      lcp: entry(last(marks, 'lcp')),
      fontsReady: rel(first(marks, 'fonts-ready')),
    },
    durations: {
      processToMainMs: main?.uptimeMs ?? null,
      processToShownMs: main && shown ? main.uptimeMs + (shown.now - main.now) : null,
      dbInitMs: first(marks, 'db-init-total')?.ms ?? null,
      dbOpenMs: first(marks, 'db-open')?.ms ?? null,
      dbSchemaMs: first(marks, 'db-schema')?.ms ?? null,
      dbMigrateMs: first(marks, 'db-migrate')?.ms ?? null,
      migrateRebuild: first(marks, 'migrate-rebuild')?.ms ?? null,
      migrateRebuildSkipped: Boolean(first(marks, 'migrate-rebuild-skipped')),
      orphanSkipped: first(marks, 'migrate-orphan')?.skipped ?? null,
      orphanMs: first(marks, 'migrate-orphan')?.ms ?? null,
      windowStateMs: first(marks, 'window-state')?.ms ?? null,
      menuMs: first(marks, 'install-menu')?.ms ?? null,
      ipcRoundTripMs: first(marks, 'ipc-recv')?.roundTripMs ?? null,
      handlerMs: first(marks, 'ipc-listByDate')?.handlerMs ?? null,
      queryMs: first(marks, 'ipc-listByDate')?.queryMs ?? null,
      validateMs: first(marks, 'ipc-listByDate')?.validateMs ?? null,
      rows: first(marks, 'ipc-listByDate')?.rows ?? null,
      gotoFlushMs: first(marks, 'goto-flushed')?.ms ?? null,
      backupMs: first(marks, 'backup-end')?.ms ?? null,
      backupCopied: first(marks, 'backup-end')?.copied ?? null,
      preloadMs:
        first(marks, 'preload-start') && first(marks, 'preload-end')
          ? Math.round((first(marks, 'preload-end').perf - first(marks, 'preload-start').perf) * 100) / 100
          : null,
      jsEvalToRenderMs:
        first(marks, 'js-eval-start') && first(marks, 'react-render-start')
          ? Math.round((first(marks, 'react-render-start').perf - first(marks, 'js-eval-start').perf) * 100) / 100
          : null,
      renderToCommitMs:
        first(marks, 'react-render-start') && first(marks, 'react-commit')
          ? Math.round((first(marks, 'react-commit').perf - first(marks, 'react-render-start').perf) * 100) / 100
          : null,
    },
    ipcChannels: marks.filter((mark) => mark.label === 'ipc-call' || mark.label === 'ipc-listByDate').map((mark) => mark.channel ?? 'tasks:listByDate'),
    renderCounts: first(marks, 'render-counts') ?? null,
    resources: first(marks, 'resources') ?? null,
    slowResources: marks.filter((mark) => mark.label === 'resource-slow'),
    fonts: marks.filter((mark) => mark.label === 'font-file' || mark.label === 'font-loadingdone' || mark.label === 'fonts-ready' || mark.label === 'font-faces'),
    longTasks: marks.filter((mark) => mark.label === 'longtask' || mark.label === 'loaf'),
    shell: first(marks, 'shell-visible'),
    task: first(marks, 'task-visible'),
    ready: first(marks, 'task-ready-for-input'),
    flow: first(marks, 'react-flow-init'),
    pragmas: first(marks, 'db-pragma-values'),
    devtools: first(marks, 'devtools-opened'),
    windows: first(marks, 'window-count'),
    csp: first(marks, 'csp-header-checks'),
    packaged: first(marks, 'when-ready')?.packaged ?? null,
    navigation: first(marks, 'navigation'),
    reason: first(marks, 'measure-done')?.reason ?? null,
    backupOverlapsIpc: overlaps(first(marks, 'backup-start'), first(marks, 'backup-end'), first(marks, 'ipc-listByDate')),
  }
}

function overlaps(start, end, point) {
  if (!start || !end || !point) return null
  return point.now >= start.now && point.now <= end.now
}

function median(values) {
  const nums = values.filter((value) => typeof value === 'number').sort((a, b) => a - b)
  if (nums.length === 0) return null
  return nums[Math.floor(nums.length / 2)]
}

function slowest(values) {
  const nums = values.filter((value) => typeof value === 'number')
  if (nums.length === 0) return null
  return Math.max(...nums)
}

async function launchOnce(mode, logFile, extraArgs = []) {
  rmSync(logFile, { force: true })
  const env = { ...process.env, BRANCHLOG_USER_DATA: userData, BRANCHLOG_MEASURE: '1', BRANCHLOG_MEASURE_LOG: logFile }
  delete env.ELECTRON_RENDERER_URL
  let command = process.execPath
  let spawnArgs = []
  let cwd = root
  if (mode === 'dev') {
    command = 'npm'
    spawnArgs = ['run', 'dev']
    if (extraArgs.length > 0) spawnArgs.push('--', ...extraArgs)
  } else if (mode === 'prod') {
    spawnArgs = [electronCli, root, ...extraArgs]
  } else {
    command = packagedExe
    spawnArgs = extraArgs
    cwd = path.dirname(packagedExe)
  }
  const child = spawn(command, spawnArgs, {
    cwd,
    env,
    shell: mode === 'dev',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  })
  const output = []
  let failed = false
  child.stdout?.on('data', (chunk) => output.push(chunk))
  child.stderr?.on('data', (chunk) => output.push(chunk))
  child.on('error', (error) => {
    failed = true
    output.push(Buffer.from(String(error)))
  })
  const timeout = mode === 'dev' ? 120000 : 45000
  const started = Date.now()
  let text = ''
  while (!failed && Date.now() - started < timeout) {
    if (existsSync(logFile)) text = readFileSync(logFile, 'utf8')
    if (text.includes('"label":"measure-done"')) break
    if (child.exitCode !== null) break
    await sleep(100)
  }
  const exitWait = Date.now()
  while (child.exitCode === null && Date.now() - exitWait < 8000) await sleep(100)
  if (child.exitCode === null && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  spawnSync('taskkill', ['/IM', 'Branchlog.exe', '/T', '/F'], { stdio: 'ignore' })
  await sleep(1200)
  if (existsSync(logFile)) text = readFileSync(logFile, 'utf8')
  const consoleText = Buffer.concat(output).toString('utf8')
  writeFileSync(`${logFile}.console`, consoleText)
  return `${text}\n${consoleText}`
}

async function sample(mode, temperature, index, extraArgs = []) {
  const logFile = path.join(results, `${mode}-${temperature}-${index}.log`)
  const raw = await launchOnce(mode, logFile, extraArgs)
  const marks = parseLog(raw)
  const summary = summarize(marks)
  writeFileSync(path.join(results, `${mode}-${temperature}-${index}.json`), JSON.stringify(summary, null, 2))
  const visible = summary.fromShown.taskVisible
  console.log(`${mode} ${temperature} ${index}: task ${visible ?? 'missing'} ms, reason ${summary.reason}`)
  return summary
}

function aggregate(samples) {
  const keys = Object.keys(samples[0]?.fromShown ?? {})
  const fromShown = {}
  for (const key of keys) {
    const values = samples.map((sample) => sample.fromShown[key])
    fromShown[key] = { median: median(values), slowest: slowest(values), values }
  }
  const durationKeys = Object.keys(samples[0]?.durations ?? {})
  const durations = {}
  for (const key of durationKeys) {
    const values = samples.map((sample) => sample.durations[key]).filter((value) => typeof value === 'number')
    durations[key] = values.length ? { median: median(values), slowest: slowest(values), values } : samples.map((sample) => sample.durations[key])
  }
  const ranked = [...samples].filter((sample) => typeof sample.fromShown.taskVisible === 'number')
  ranked.sort((a, b) => a.fromShown.taskVisible - b.fromShown.taskVisible)
  return { fromShown, durations, medianRun: ranked[Math.floor(ranked.length / 2)] ?? null, failures: samples.filter((sample) => sample.reason !== 'ready').length }
}

async function traceMode(mode) {
  const trace = path.join(results, `trace-${mode}.json`)
  rmSync(trace, { force: true })
  const extra = [
    '--trace-startup',
    `--trace-startup-file=${trace}`,
    '--trace-startup-duration=12',
  ]
  await sample(mode, 'trace', 1, extra)
  return parseTrace(trace)
}

function parseTrace(file) {
  if (!existsSync(file)) return { missing: true }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'parse failed', bytes: statSync(file).size }
  }
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents ?? []
  const threads = new Map()
  const processes = new Map()
  for (const event of events) {
    if (event.ph !== 'M') continue
    if (event.name === 'thread_name') threads.set(`${event.pid}:${event.tid}`, event.args?.name)
    if (event.name === 'process_name') processes.set(event.pid, event.args?.name)
  }
  const rendererTids = [...threads.entries()]
    .filter(([, name]) => name === 'CrRendererMain' || name === 'Renderer')
    .map(([key]) => key)
  const long = []
  for (const event of events) {
    if (event.ph !== 'X' || typeof event.dur !== 'number' || event.dur < 50000) continue
    const key = `${event.pid}:${event.tid}`
    if (!rendererTids.includes(key)) continue
    const data = event.args?.data ?? {}
    long.push({
      name: event.name,
      durMs: Math.round(event.dur / 100) / 10,
      functionName: data.functionName || data.scriptName || '',
      url: typeof data.url === 'string' ? data.url.slice(-140) : '',
      ts: event.ts,
    })
  }
  long.sort((a, b) => a.ts - b.ts)
  return {
    bytes: statSync(file).size,
    events: events.length,
    rendererThreads: rendererTids.map((key) => threads.get(key)),
    processes: [...processes.values()],
    longTasks: long,
  }
}

async function packageApp() {
  const dest = path.dirname(packagedExe)
  mkdirSync(dest, { recursive: true })
  cpSync(path.join(root, 'node_modules', 'electron', 'dist'), dest, { recursive: true })
  const stage = path.join(results, 'stage')
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(path.join(stage, 'node_modules', 'better-sqlite3', 'prebuilds'), { recursive: true })
  cpSync(path.join(root, 'out'), path.join(stage, 'out'), { recursive: true })
  const sqlite = path.join(root, 'node_modules', 'better-sqlite3')
  cpSync(path.join(sqlite, 'lib'), path.join(stage, 'node_modules', 'better-sqlite3', 'lib'), { recursive: true })
  cpSync(path.join(sqlite, 'package.json'), path.join(stage, 'node_modules', 'better-sqlite3', 'package.json'))
  cpSync(
    path.join(sqlite, 'prebuilds', 'win32-x64.node'),
    path.join(stage, 'node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node'),
  )
  writeFileSync(
    path.join(stage, 'package.json'),
    JSON.stringify({ name: 'branchlog', version: '0.1.0', main: './out/main/index.js' }),
  )
  const asarPath = path.join(dest, 'resources', 'app.asar')
  const asar = await import(pathToFileURL(path.join(results, 'asar-tool', 'node_modules', '@electron', 'asar', 'lib', 'asar.js')).href)
  await asar.createPackageWithOptions(stage, asarPath, { unpack: '**/*.node' })
  if (!existsSync(asarPath)) throw new Error('asar pack failed')
  const exe = path.join(dest, 'electron.exe')
  const renamed = path.join(dest, 'Branchlog.exe')
  if (existsSync(exe)) {
    rmSync(renamed, { force: true })
    renameSync(exe, renamed)
  }
  if (!existsSync(renamed)) throw new Error('Packaged executable was not created')
  return { dest, asar: walk(path.join(dest, 'resources')), folder: walk(dest) }
}

function defenderStatus() {
  const status = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', 'Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, IoavProtectionEnabled, AMServiceEnabled | ConvertTo-Json'],
    { encoding: 'utf8' },
  )
  return { status: status.status, stdout: status.stdout, stderr: status.stderr }
}

function fontSizes() {
  const files = [
    'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2',
    'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff',
    'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2',
    'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff',
    'node_modules/@fontsource/newsreader/files/newsreader-latin-400-normal.woff2',
    'node_modules/@fontsource/newsreader/files/newsreader-latin-400-normal.woff',
    'node_modules/@fontsource/newsreader/files/newsreader-latin-600-normal.woff2',
    'node_modules/@fontsource/newsreader/files/newsreader-latin-600-normal.woff',
  ]
  return files.map((file) => ({ file, bytes: statSync(path.join(root, file)).size }))
}

async function main() {
  mkdirSync(results, { recursive: true })
  const machine = {
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memoryMb: Math.round(totalmem() / 1024 / 1024),
  }
  console.log('seeding')
  const database = seed()
  let packaged = null
  if (!skipPackage && modes.some((mode) => mode === 'packaged' || mode === 'prod')) {
    if (modes.includes('packaged')) {
      console.log('packaging')
      packaged = await packageApp()
    }
  }
  const bundles = {
    out: walk(path.join(root, 'out')),
    outFiles: readdirSync(path.join(root, 'out', 'renderer', 'assets')).map((name) => ({
      name,
      bytes: statSync(path.join(root, 'out', 'renderer', 'assets', name)).size,
    })),
    electronDist: walk(path.join(root, 'node_modules', 'electron', 'dist')),
    fonts: fontSizes(),
    packaged,
  }
  const collected = {}
  for (const mode of modes) {
    collected[mode] = { cold: [], warm: [] }
    for (let index = 1; index <= runs; index += 1) {
      if (index > 1) await sleep(5000)
      collected[mode].cold.push(await sample(mode, 'cold', index))
    }
    for (let index = 1; index <= runs; index += 1) {
      await sleep(300)
      collected[mode].warm.push(await sample(mode, 'warm', index))
    }
  }
  const stats = {}
  for (const mode of modes) {
    stats[mode] = {
      cold: aggregate(collected[mode].cold),
      warm: aggregate(collected[mode].warm),
    }
  }
  const summary = { machine, database, bundles, defender: defenderStatus(), stats }
  writeFileSync(path.join(results, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log('wrote summary')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
