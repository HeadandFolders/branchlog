import { expect, type Locator, type Page } from '@playwright/test'
import { writeTask } from './launch'
import { enableAi } from './ai-helpers'

export const PARENT_TEXT = 'ship the quarterly report'
export const BRANCH_TEXT = 'How should I start the report?'

export async function prepareAsk(page: Page, url: string): Promise<Locator> {
  await writeTask(page, PARENT_TEXT)
  await page.getByRole('button', { name: 'Branch from this task' }).first().click()
  await page.keyboard.type(BRANCH_TEXT)
  const branch = page.locator('.react-flow__node-branch').first()
  await expect(branch.locator('[data-task-text]')).toHaveText(BRANCH_TEXT)
  await enableAi(page, url)
  return branch
}

export async function askBranch(branch: Locator): Promise<void> {
  await branch.hover()
  await branch.getByRole('button', { name: 'Ask AI', exact: true }).click()
}

export async function keepAnswer(page: Page, branch: Locator): Promise<void> {
  const wrapper = branch.locator('[data-ai-text] [data-keep-text]')
  await wrapper.hover()
  await wrapper.evaluate((element) => {
    const node = element.querySelector('[data-offset="0"]')?.firstChild
    if (!node) throw new Error('Missing full answer')
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, 21)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  await page.locator('[data-keep-label]').click()
  await page.mouse.move(5, 5)
  await expect(wrapper).toHaveAttribute('data-keep-state', 'kept')
  await expect(wrapper.locator('[data-kept-range]')).toHaveText('Start with an outline')
}
