const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const result = spawnSync('electron-rebuild', ['-f', '-w', 'better-sqlite3'], {
  stdio: 'inherit',
  shell: true,
})

if (result.status === 0) {
  process.exit(0)
}

const prebuild = path.join(
  __dirname,
  '..',
  'node_modules',
  'better-sqlite3',
  'prebuilds',
  `${process.platform}-${process.arch}.node`,
)

if (fs.existsSync(prebuild)) {
  console.log(
    'electron-rebuild could not compile better-sqlite3. Using the shipped N-API prebuild, which Electron can load without a local C++ toolchain.',
  )
  process.exit(0)
}

process.exit(result.status === null ? 1 : result.status)
