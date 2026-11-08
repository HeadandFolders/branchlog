import { pathToFileURL } from 'node:url'
import path from 'node:path'
const asar = await import(pathToFileURL(path.resolve('first-paint-results/asar-tool/node_modules/@electron/asar/lib/asar.js')).href)
const file = path.resolve('release-measure-2/Branchlog/resources/app.asar')
const html = asar.extractFile(file, 'out/renderer/index.html').toString('utf8')
const script = html.match(/index-[^"]+\.js/)?.[0]
console.log('script', script)
const js = asar.extractFile(file, `out/renderer/assets/${script}`)
const text = js.toString('utf8')
console.log('bytes', js.length)
console.log('pasteForest', text.includes('pasteForest'))
console.log('installClipboard', text.includes('installClipboard'))
console.log('TEMP html-parse', html.includes('TEMP html-parse'))
