import { localDateKey, msUntilNextLocalMidnight } from '../src/shared/dates.ts'

const date = new Date(Number(process.argv[2]))
process.stdout.write(`${localDateKey(date)}\n${String(msUntilNextLocalMidnight(date))}\n`)
