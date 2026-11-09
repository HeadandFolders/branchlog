import path from 'node:path'
import Database from 'better-sqlite3'
import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { writeTask } from './launch'
import { enableAi } from './ai-helpers'

export async function mouseSelect(page: Page, wrapper: Locator, start: number, end: number, releaseOutside = false): Promise<void> {
  const kept = wrapper.locator('xpath=ancestor::*[@data-ai-comment][1]').locator('[data-kept-range]').first()
  if (await kept.count() > 0) await kept.hover()
  else await wrapper.hover()
  const points = await wrapper.evaluate((element, offsets) => {
    const holders = [...element.querySelectorAll<HTMLElement>('[data-offset]')]
    const point = (offset: number, ending: boolean) => {
      const index = ending ? offset - 1 : offset
      const holder = holders.find((item) => {
        const from = Number(item.dataset.offset)
        return index >= from && index < from + (item.firstChild?.textContent?.length ?? 0)
      })
      if (!holder?.firstChild) throw new Error('Missing selectable text')
      const range = document.createRange()
      const local = index - Number(holder.dataset.offset)
      range.setStart(holder.firstChild, local)
      range.setEnd(holder.firstChild, local + 1)
      const rect = range.getBoundingClientRect()
      return { x: ending ? rect.right - 0.25 : rect.left + 0.25, y: rect.top + rect.height / 2 }
    }
    return { start: point(offsets.start, false), end: point(offsets.end, true) }
  }, { start, end })
  await page.mouse.move(points.start.x, points.start.y)
  await page.mouse.down()
  await page.mouse.move(points.end.x, points.end.y, { steps: 8 })
  if (releaseOutside) {
    const box = await wrapper.boundingBox()
    if (!box) throw new Error('Missing text bounds')
    await page.mouse.move(box.x + box.width + 2, points.end.y)
  }
  await page.mouse.up()
}

export function savedRanges(userData: string) {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const comments = db.prepare('SELECT keptRanges FROM aiComments ORDER BY rowid').all() as { keptRanges: string }[]
  const replies = db.prepare('SELECT keptRanges FROM aiReplies ORDER BY rowid').all() as { keptRanges: string }[]
  db.close()
  return { comments: comments.map((row) => row.keptRanges), replies: replies.map((row) => row.keptRanges) }
}

export async function prepareComment(page: Page, url: string): Promise<Locator> {
  await enableAi(page, url)
  await writeTask(page, 'ship the quarterly report')
  const wrapper = page.locator('[data-ai-text] [data-keep-text]')
  await expect(wrapper).toHaveText('What does done look like for this?')
  return wrapper
}
