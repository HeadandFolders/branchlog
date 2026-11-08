import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const dir = path.dirname(new URL(import.meta.url).pathname)
// Windows pathname starts with /C: 
const folder = path.join(process.cwd(), 'first-paint-results')
const files = readdirSync(folder).filter((name) => /^\w+-(\w+)-\d+\.json$/.test(name) && !name.includes('kept'))
const rows = []
for (const name of files.sort()) {
  const data = JSON.parse(readFileSync(path.join(folder, name), 'utf8'))
  const shown = data.fromShown
  const dur = data.durations
  rows.push({
    run: name.replace('.json', ''),
    reason: data.reason,
    task: shown.taskVisible,
    shell: shown.shellVisible,
    fcp: shown.fcp,
    lcp: shown.lcp,
    commit: shown.reactCommit,
    js: shown.jsEval,
    html: shown.htmlParse,
    loadStart: shown.didStartLoading,
    ipc: dur.ipcRoundTripMs,
    query: dur.queryMs,
    handler: dur.handlerMs,
    rows: dur.rows,
    db: dur.dbInitMs,
    dbOpen: dur.dbOpenMs,
    toShown: dur.processToShownMs,
    evalMs: dur.jsEvalToRenderMs,
    renderMs: dur.renderToCommitMs,
    preload: dur.preloadMs,
    flush: dur.gotoFlushMs,
    backup: dur.backupMs,
    copied: dur.backupCopied,
    rebuildSkipped: dur.migrateRebuildSkipped,
    orphanSkipped: dur.orphanSkipped,
    resources: data.resources?.count ?? null,
    scripts: data.resources?.scripts ?? null,
    fonts: data.resources?.fonts ?? null,
    csp: data.csp?.count ?? null,
    devtools: data.devtools?.open ?? null,
    packaged: data.packaged,
    commits: shown.reactCommits,
    flowRenders: data.renderCounts?.DailyFlow ?? null,
    listRenders: data.renderCounts?.MainListNode ?? null,
    bulletRenders: data.renderCounts?.TaskBullet ?? null,
    measures: shown.flowMeasureEvents,
    rebuilds: shown.canvasRebuilds,
    channels: data.ipcChannels,
    long: (data.longTasks ?? []).filter((task) => task.duration >= 50).map((task) => ({
      type: task.label,
      ms: task.duration,
      scripts: task.scripts,
    })),
    slow: (data.slowResources ?? []).slice(0, 8).map((item) => ({
      name: item.name,
      ms: item.duration,
      bytes: item.encodedBodySize,
      type: item.initiatorType,
    })),
    fontReady: data.fonts?.find((item) => item.label === 'fonts-ready') ?? null,
    fontFiles: (data.fonts ?? []).filter((item) => item.label === 'font-file').map((item) => ({
      name: String(item.name).slice(-80),
      ms: item.duration,
      bytes: item.encodedBodySize,
    })),
    taskFont: data.task?.fontFamily ?? null,
    editable: data.ready?.contentEditable ?? null,
    zoom: data.flow?.zoom ?? null,
    nodes: data.flow?.nodes ?? null,
    sync: data.pragmas?.synchronous ?? null,
    journal: data.pragmas?.journal ?? null,
  })
}
writeFileSync(path.join(folder, 'compact.json'), JSON.stringify(rows, null, 2))
for (const row of rows) {
  console.log(
    [
      row.run.padEnd(22),
      'task', String(row.task).padStart(5),
      'shown', String(row.toShown).padStart(6),
      'fcp', String(row.fcp).padStart(5),
      'query', String(row.query).padStart(6),
      'ipc', String(row.ipc).padStart(6),
      'eval', String(row.evalMs).padStart(6),
      'react', String(row.renderMs).padStart(6),
      'res', String(row.resources).padStart(4),
      'bullets', String(row.bulletRenders).padStart(4),
      row.reason,
    ].join(' '),
  )
}
