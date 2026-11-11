import type Database from 'better-sqlite3'

export interface IntegrityViolation {
  problem: string
  id: string
  text: string
  dateCreated: string
  missingReference: string | null
}

const CHECKS = `
SELECT 'chainId points at a missing row' AS problem, id, text, dateCreated, chainId AS missingReference
  FROM tasks WHERE chainId NOT IN (SELECT id FROM tasks)
UNION ALL
SELECT 'carriedFromId points at a missing row', id, text, dateCreated, carriedFromId AS missingReference
  FROM tasks WHERE carriedFromId IS NOT NULL AND carriedFromId NOT IN (SELECT id FROM tasks)
UNION ALL
SELECT 'parentId points at a missing row', id, text, dateCreated, parentId AS missingReference
  FROM tasks WHERE parentId IS NOT NULL AND parentId NOT IN (SELECT id FROM tasks)
UNION ALL
SELECT 'two copies of one chain on one date', MIN(id), MIN(text), dateCreated, chainId
  FROM tasks GROUP BY chainId, dateCreated HAVING COUNT(*) > 1
UNION ALL
SELECT 'carry skip for a chain that is gone', chainId, '', dateKey, chainId
  FROM carrySkips WHERE chainId NOT IN (SELECT id FROM tasks)
UNION ALL
SELECT 'carry skip for a date the chain already holds', s.chainId, t.text, s.dateKey, s.chainId
  FROM carrySkips AS s JOIN tasks AS t ON t.chainId = s.chainId AND t.dateCreated = s.dateKey
UNION ALL
SELECT 'chain key is not its earliest copy', k.chainId, '', k.firstDate, k.chainId
  FROM (SELECT chainId, MIN(dateCreated) AS firstDate FROM tasks GROUP BY chainId) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM tasks AS e WHERE e.chainId = k.chainId AND e.dateCreated = k.firstDate AND e.id = k.chainId
  )
ORDER BY problem, id
`

export function checkChainIntegrity(db: Database.Database): IntegrityViolation[] {
  return db.prepare(CHECKS).all() as IntegrityViolation[]
}
