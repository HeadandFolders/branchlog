import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeApp, launchApp, writeTask } from './launch'

const PAD = 12
const BRANCH_TEXT = 'Ship it'
const STATES = ['rest', 'hovered', 'selected', 'checked'] as const

type State = (typeof STATES)[number]

async function toRest(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await page.mouse.move(0, 0)
}

function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    const probe = document.createElement('span')
    probe.style.color = raw
    probe.style.position = 'absolute'
    probe.style.opacity = '0'
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
}

async function makeBranch(page: Page): Promise<Locator> {
  await writeTask(page, 'Origin')
  await page.getByRole('button', { name: 'Branch from this task' }).click()
  const branch = page.locator('.react-flow__node-branch').first()
  const text = branch.locator('[data-task-text]')
  await expect(text).toBeVisible()
  await page.keyboard.type(BRANCH_TEXT)
  await expect(text).toHaveText(BRANCH_TEXT)
  // A baseline is only comparable while the line it photographs stays one line.
  const lines = await text.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return range.getClientRects().length
  })
  expect(lines).toBe(1)
  return branch
}

async function setState(page: Page, branch: Locator, state: State): Promise<void> {
  await toRest(page)
  if (state === 'rest' || state === 'hovered') return
  if (state === 'selected') {
    await branch.click({ position: { x: 6, y: 6 } })
    await expect(branch).toHaveClass(/selected/)
    await page.mouse.move(0, 0)
    return
  }
  await branch.hover()
  await branch.locator('.task-check').click()
  await expect(branch.locator('[data-task-row]')).toHaveAttribute('data-state', 'done')
  await toRest(page)
}

// The handles and the selection outline sit outside the node box, so the frame is
// padded rather than clipped to the node itself.
async function photograph(page: Page, branch: Locator, name: string, state: State): Promise<void> {
  const box = await branch.boundingBox()
  if (!box) throw new Error('Missing branch box')
  const viewport = page.viewportSize()
  const x = Math.max(0, Math.round(box.x - PAD))
  const y = Math.max(0, Math.round(box.y - PAD))
  const right = Math.min(viewport?.width ?? Infinity, Math.round(box.x + box.width + PAD))
  const bottom = Math.min(viewport?.height ?? Infinity, Math.round(box.y + box.height + PAD))
  const options = {
    clip: { x, y, width: right - x, height: bottom - y },
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  } as const
  // A headful Electron window can swallow the move that carries :hover, so the
  // hovered frame is only taken once the hover paint is on screen, and retaken
  // if the capture itself lands on a frame where the pointer state was lost.
  for (let attempt = 0; ; attempt += 1) {
    if (state === 'hovered') {
      await branch.hover()
      await expect(branch).toHaveCSS('background-color', await tokenColor(page, '--bg-subtle'))
      await expect(branch.locator('.task-actions')).toHaveCSS('opacity', '1')
    }
    try {
      await expect(page).toHaveScreenshot(`${name}.png`, options)
      return
    } catch (error) {
      if (state !== 'hovered' || attempt >= 2) throw error
    }
  }
}

for (const scheme of ['light', 'dark'] as const) {
  test(`a branch node reads correctly at rest, hovered, selected and checked in ${scheme}`, async () => {
    const { app, page, userData } = await launchApp()
    try {
      await page.bringToFront()
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      const branch = await makeBranch(page)
      for (const state of STATES) {
        await setState(page, branch, state)
        await photograph(page, branch, `branch-${state}-${scheme}`, state)
      }
    } finally {
      await closeApp(app, userData)
    }
  })
}
