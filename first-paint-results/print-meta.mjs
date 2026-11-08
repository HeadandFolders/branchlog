import { readFileSync } from 'node:fs'
const summary = JSON.parse(readFileSync('first-paint-results/summary.json', 'utf8'))
const pick = {
  machine: summary.machine,
  database: summary.database,
  bundles: summary.bundles,
  defender: summary.defender,
}
console.log(JSON.stringify(pick, null, 2))
