import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'
import { enableAi } from './ai-helpers'
import { askBranch, prepareAsk } from './ai-ask-helpers'
import { startMockLmStudio } from './mock-lm-studio'

const LET_GO = "Let go (won't carry over)"
const WRAPPED = 'A branch that wraps onto several lines. '.repeat(8)

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Missing box')
  return box
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  )
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
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

function opacity(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).opacity)
}

async function toRest(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await page.mouse.move(8, 400)
}

async function makeBranch(page: Page, text: string): Promise<Locator> {
  await writeTask(page, 'Origin')
  await page.getByRole('button', { name: 'Branch from this task' }).click()
  const branch = page.locator('.react-flow__node-branch').first()
  await expect(branch.locator('[data-task-text]')).toBeVisible()
  await page.keyboard.type(text)
  await expect(branch.locator('[data-task-text]')).toHaveText(text)
  return branch
}

async function edgeEnd(page: Page, branch: Locator): Promise<{ x: number; y: number }> {
  const id = await branch.locator('[data-task-text]').getAttribute('data-task-id')
  if (!id) throw new Error('Branch id is missing')
  return page.locator(`[data-testid="rf__edge-edge-${id}"] .react-flow__edge-path`).evaluate((path) => {
    const element = path as SVGPathElement
    const point = element.getPointAtLength(element.getTotalLength())
    const matrix = element.getScreenCTM()
    if (!matrix) throw new Error('Missing edge')
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix)
    return { x: screen.x, y: screen.y }
  })
}

async function expectArrowOnCheckbox(page: Page, branch: Locator): Promise<void> {
  const check = await boxOf(branch.locator('.task-check'))
  const end = await edgeEnd(page, branch)
  expect(Math.abs(end.y - (check.y + check.height / 2))).toBeLessThanOrEqual(2)
  expect(Math.abs(end.x - check.x)).toBeLessThanOrEqual(2)
}

test('a branch is bare at rest and its whole action row appears inside the node on hover', async () => {
  const { app, page, userData } = await launchApp()
  try {
    const branch = await makeBranch(page, 'axe too big')
    await toRest(page)
    const chrome = await branch.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        border: style.borderTopWidth,
        shadow: style.boxShadow,
        outline: style.outlineStyle,
        background: style.backgroundColor,
      }
    })
    expect(chrome).toEqual({
      border: '0px',
      shadow: 'none',
      outline: 'none',
      background: 'rgba(0, 0, 0, 0)',
    })
    const actions = branch.locator('.task-actions')
    expect(await opacity(actions)).toBe('0')

    const rest = await boxOf(branch)
    await branch.hover()
    expect(await opacity(actions)).toBe('1')
    expect(await branch.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      await tokenColor(page, '--bg-subtle'),
    )

    const node = await boxOf(branch)
    const controls = branch.locator('.task-action')
    expect(await controls.count()).toBe(2)
    for (let index = 0; index < 2; index += 1) {
      expect(contains(node, await boxOf(controls.nth(index)))).toBe(true)
    }
    expect(contains(node, await boxOf(actions))).toBe(true)
    expect(contains(node, await boxOf(branch.locator('.branch-dot')))).toBe(true)

    // Nothing the node owns is painted below its box.
    const strays = await branch.evaluate((element) => {
      const own = element.getBoundingClientRect()
      return [...element.querySelectorAll('button')]
        .filter((button) => button.getBoundingClientRect().bottom > own.bottom + 0.5)
        .map((button) => button.className)
    })
    expect(strays).toEqual([])

    // Revealing the row changes neither the node nor the text it sits beside.
    expect(await boxOf(branch)).toEqual(rest)
    const textHovered = await boxOf(branch.locator('[data-task-text]'))
    await toRest(page)
    expect(await boxOf(branch)).toEqual(rest)
    expect(await boxOf(branch.locator('[data-task-text]'))).toEqual(textHovered)
  } finally {
    await closeApp(app, userData)
  }
})

test('the pointer reaches every control in small steps without the row vanishing', async () => {
  const { app, page, userData } = await launchApp()
  try {
    const branch = await makeBranch(page, 'walk over here')
    await toRest(page)
    const actions = branch.locator('.task-actions')
    const text = await boxOf(branch.locator('[data-task-text]'))
    const start = { x: text.x + 4, y: text.y + text.height / 2 }

    for (const action of ['let-go', 'delete']) {
      await page.mouse.move(start.x, start.y)
      expect(await opacity(actions)).toBe('1')
      const target = await boxOf(branch.locator(`.task-action[data-action="${action}"]`))
      const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
      for (let step = 1; step <= 12; step += 1) {
        await page.mouse.move(
          start.x + ((end.x - start.x) * step) / 12,
          start.y + ((end.y - start.y) * step) / 12,
        )
        expect(await opacity(actions)).toBe('1')
      }
      const hit = await page.evaluate(
        ({ x, y, name }) => {
          const element = document.elementFromPoint(x, y)
          return element?.closest(`.task-action[data-action="${name}"]`) !== null
        },
        { ...end, name: action },
      )
      expect(hit).toBe(true)
    }
  } finally {
    await closeApp(app, userData)
  }
})

test('every control is an unlabelled 16px icon on a 24px target, in one muted token', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const branch = await makeBranch(page, 'three matching tools')
    await enableAi(page, mock.url)
    await toRest(page)
    await branch.hover()

    const labels = [
      { action: 'let-go', label: LET_GO },
      { action: 'ask-ai', label: 'Ask AI' },
      { action: 'delete', label: 'Delete' },
    ]
    const muted = await tokenColor(page, '--text-muted')
    const dropped = await tokenColor(page, '--dropped')
    for (const { action, label } of labels) {
      const control = branch.locator(`.task-action[data-action="${action}"]`)
      await expect(control).toHaveAttribute('aria-label', label)
      await expect(control).toHaveAttribute('title', label)
      expect((await control.textContent())?.trim()).toBe('')
      const box = await boxOf(control)
      expect(box.width).toBe(24)
      expect(box.height).toBe(24)
      const icon = await control.locator('svg').evaluate((element) => ({
        width: element.getAttribute('width'),
        height: element.getAttribute('height'),
        stroke: element.getAttribute('stroke'),
        strokeWidth: getComputedStyle(element).strokeWidth,
        color: getComputedStyle(element).stroke,
      }))
      expect(icon).toEqual({
        width: '16',
        height: '16',
        stroke: 'currentColor',
        strokeWidth: '1.5px',
        color: muted,
      })
    }
    // Letting go is not destructive, so it never wears the dropped color at rest.
    expect(muted).not.toBe(dropped)

    for (const word of ['Delete', 'Ask AI', 'Let go']) {
      await expect(branch.getByText(word, { exact: true })).toHaveCount(0)
    }
    const dot = await boxOf(branch.locator('.branch-dot'))
    expect(dot.width).toBe(12)
    expect(dot.height).toBe(12)
    const last = await boxOf(branch.locator('.task-action[data-action="delete"]'))
    expect(dot.x - (last.x + last.width)).toBeGreaterThanOrEqual(8)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('task text stays on --text through rest, hover, selection and focus, and never on --ai', async () => {
  const { app, page, userData } = await launchApp()
  try {
    const branch = await makeBranch(page, 'my own words')
    const text = branch.locator('[data-task-text]')
    const expected = await tokenColor(page, '--text')
    const ai = await tokenColor(page, '--ai')
    expect(expected).not.toBe(ai)

    const color = () => text.evaluate((element) => getComputedStyle(element).color)
    const family = () => text.evaluate((element) => getComputedStyle(element).fontFamily)
    await toRest(page)
    expect(await color()).toBe(expected)
    await branch.hover()
    expect(await color()).toBe(expected)
    await branch.click({ position: { x: 6, y: 6 } })
    expect(await color()).toBe(expected)
    await text.click()
    expect(await color()).toBe(expected)
    for (const value of [expected, expected, expected, expected]) expect(value).not.toBe(ai)
    expect(await family()).toContain('Inter')

    const metrics = await text.evaluate((element) => {
      const style = getComputedStyle(element)
      return { size: style.fontSize, height: style.lineHeight }
    })
    const main = await page.locator('.task-list [data-task-text]').first().evaluate((element) => {
      const style = getComputedStyle(element)
      return { size: style.fontSize, height: style.lineHeight }
    })
    expect(metrics).toEqual(main)

    await toRest(page)
    await branch.hover()
    await branch.locator('.task-check').click()
    await expect(branch.locator('[data-task-row]')).toHaveAttribute('data-state', 'done')
    expect(await color()).toBe(await tokenColor(page, '--text-muted'))
    expect(await text.evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe('line-through')
  } finally {
    await closeApp(app, userData)
  }
})

test('selected resize handles are 8px on tokens, clear of the controls, and gone when deselected', async () => {
  const { app, page, userData } = await launchApp()
  try {
    const branch = await makeBranch(page, 'handle clearance')
    await toRest(page)
    await expect(branch.locator('.react-flow__resize-control.handle')).toHaveCount(0)
    await branch.click({ position: { x: 6, y: 6 } })
    const handles = branch.locator('.react-flow__resize-control.handle')
    await expect(handles).toHaveCount(4)
    expect(await branch.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')
    expect(await branch.evaluate((element) => getComputedStyle(element).outlineColor)).toBe(
      await tokenColor(page, '--line'),
    )

    const node = await boxOf(branch)
    const controls = branch.locator('.task-action')
    const controlBoxes = [await boxOf(controls.nth(0)), await boxOf(controls.nth(1))]
    const line = await tokenColor(page, '--line')
    const bg = await tokenColor(page, '--bg')
    for (let index = 0; index < 4; index += 1) {
      const handle = handles.nth(index)
      const box = await boxOf(handle)
      expect(box.width).toBe(8)
      expect(box.height).toBe(8)
      const paint = await handle.evaluate((element) => {
        const style = getComputedStyle(element)
        return { border: style.borderTopColor, background: style.backgroundColor, shadow: style.boxShadow }
      })
      expect(paint).toEqual({ border: line, background: bg, shadow: 'none' })
      const outside = Math.max(
        node.x - box.x,
        node.y - box.y,
        box.x + box.width - (node.x + node.width),
        box.y + box.height - (node.y + node.height),
      )
      expect(outside).toBeLessThanOrEqual(4)
      for (const control of controlBoxes) expect(intersects(box, control)).toBe(false)
    }

    await toRest(page)
    await expect(handles).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
  }
})

test('the arrow ends on the checkbox for a one-line, a wrapped and a resized branch', async () => {
  const { app, page, userData } = await launchApp()
  try {
    const branch = await makeBranch(page, 'short')
    const text = branch.locator('[data-task-text]')
    await toRest(page)
    await expectArrowOnCheckbox(page, branch)

    await text.click()
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.insertText(WRAPPED)
    await expect(text).toHaveText(WRAPPED)
    await toRest(page)
    const lines = await text.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return range.getClientRects().length
    })
    expect(lines).toBeGreaterThan(2)
    await expectArrowOnCheckbox(page, branch)

    await branch.click({ position: { x: 6, y: 6 } })
    const grip = branch.locator('.react-flow__resize-control.line.right')
    const box = await boxOf(grip)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => branch.evaluate((element) => element.offsetWidth)).toBeLessThan(200)
    await expectArrowOnCheckbox(page, branch)
  } finally {
    await closeApp(app, userData)
  }
})

test('Tab walks the controls in order, Enter lets go, and clicking never moves the node', async () => {
  const { app, page, userData } = await launchApp()
  try {
    const branch = await makeBranch(page, 'keyboard route')
    await toRest(page)
    const before = await boxOf(branch)
    await branch.locator('[data-task-text]').click()
    await page.keyboard.press('Tab')
    await expect(branch.locator('.task-action[data-action="let-go"]')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(branch.locator('.task-action[data-action="delete"]')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(branch.locator('.branch-dot')).toBeFocused()

    await branch.locator('[data-task-text]').click()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(branch.locator('[data-task-row]')).toHaveAttribute('data-state', 'dropped')
    // Letting go adds its own dated marker beside the text, which may re-wrap it.
    // The node itself never moves, and undoing the drop gives back the exact box.
    const dropped = await boxOf(branch)
    expect({ x: dropped.x, y: dropped.y, width: dropped.width }).toEqual({
      x: before.x,
      y: before.y,
      width: before.width,
    })

    await branch.hover()
    const undo = branch.locator('.task-action[data-action="undrop"]')
    await expect(undo).toHaveAttribute('aria-label', 'Undo drop')
    expect(await undo.evaluate((element) => getComputedStyle(element).color)).toBe(
      await tokenColor(page, '--dropped'),
    )
    await undo.click()
    await expect(branch.locator('[data-task-row]')).toHaveAttribute('data-state', 'open')
    expect(await boxOf(branch)).toEqual(before)
  } finally {
    await closeApp(app, userData)
  }
})

test('the axe still deletes the branch and its descendants, with the undo notice', async () => {
  const { app, page, userData } = await launchApp()
  try {
    const branch = await makeBranch(page, 'parent branch')
    await branch.locator('.branch-dot').click()
    const child = page.locator('.react-flow__node-branch').nth(1)
    await expect(child.locator('[data-task-text]')).toBeVisible()
    await page.keyboard.type('grandchild')
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(2)

    await toRest(page)
    await branch.hover()
    await branch.locator('.task-action[data-action="delete"]').click()
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveText('Deleted 2 tasks. Undo')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(2)
  } finally {
    await closeApp(app, userData)
  }
})

test('Ask AI still answers inside the branch from its place in the action row', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const branch = await prepareAsk(page, mock.url)
    await askBranch(branch)
    await expect(branch.locator('[data-ai-answer]')).toBeVisible()
    const node = await boxOf(branch)
    expect(contains(node, await boxOf(branch.locator('.task-action[data-action="ask-ai"]')))).toBe(true)
    await expect(branch.locator('.task-action[data-action="ask-ai"]')).toHaveAttribute('aria-label', 'Ask AI')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})
