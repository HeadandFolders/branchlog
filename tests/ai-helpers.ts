import { expect, type Page } from '@playwright/test'
import { modifier } from './launch'
import type { MockLmStudio } from './mock-lm-studio'

export async function enableAi(
  page: Page,
  url: string,
  options: { pauseMs?: number; maxComments?: number } = {},
): Promise<void> {
  await page.bringToFront()
  await page.keyboard.press(`${modifier}+,`)
  await expect(page.getByRole('complementary', { name: 'AI margin settings' })).toBeVisible()
  const address = page.getByRole('textbox', { name: 'LM Studio address' })
  await address.fill(url)
  await address.blur()
  await page.getByRole('spinbutton', { name: 'Pause before commenting (ms)' }).fill(String(options.pauseMs ?? 500))
  if (options.maxComments !== undefined) {
    await page.getByRole('spinbutton', { name: 'Max comments per day' }).fill(String(options.maxComments))
  }
  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.locator('[data-ai-connection="ok"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'AI margin settings' })).toHaveCount(0)
}

export function chatPosts(mock: MockLmStudio) {
  return mock.requests.filter((request) => request.method === 'POST' && request.url === '/v1/chat/completions')
}

export async function addMainTask(page: Page, text: string): Promise<void> {
  await page.locator('[data-task-text]').first().click()
  await page.keyboard.press(`${modifier}+End`)
  await page.keyboard.press('Enter')
  await page.keyboard.type(text)
  await expect(page.locator('[data-task-text]', { hasText: text })).toHaveCount(1)
}