import { expect, test, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'
import { startMockLmStudio } from './mock-lm-studio'

async function openPanel(page: Page): Promise<void> {
  await page.bringToFront()
  await page.keyboard.press(`${modifier}+,`)
  await expect(page.getByRole('complementary', { name: 'AI margin settings' })).toBeVisible()
}

async function setAddress(page: Page, url: string): Promise<void> {
  const field = page.getByRole('textbox', { name: 'LM Studio address' })
  await field.fill(url)
  await field.blur()
}

test('the panel opens with AI off and the defaults, and Escape closes it', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await openPanel(page)
    await expect(page.getByRole('checkbox', { name: 'Enable margin comments' })).not.toBeChecked()
    await expect(page.getByRole('textbox', { name: 'LM Studio address' })).toHaveValue('http://localhost:1234/v1')
    await expect(page.getByRole('spinbutton', { name: 'Max comments per day' })).toHaveValue('30')
    await expect(page.getByRole('spinbutton', { name: 'Pause before commenting (ms)' })).toHaveValue('2500')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('complementary', { name: 'AI margin settings' })).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
  }
})

test('Test connection lists the models, turns AI on, and the settings survive a restart', async () => {
  const mock = await startMockLmStudio({ models: ['mock-model', 'mock-mini'] })
  let { app, page, userData } = await launchApp()
  try {
    await openPanel(page)
    await setAddress(page, mock.url)
    await page.getByRole('button', { name: 'Test connection' }).click()
    await expect(page.locator('[data-ai-connection="ok"]')).toHaveText('Connected. Models: mock-model, mock-mini')
    await expect(page.getByRole('checkbox', { name: 'Enable margin comments' })).toBeChecked()
    await page.getByRole('spinbutton', { name: 'Max comments per day' }).fill('12')
    await page.getByRole('spinbutton', { name: 'Pause before commenting (ms)' }).fill('3000')
    await page.keyboard.press('Escape')
    await closeApp(app, userData, true)
    const next = await launchApp(userData)
    app = next.app
    page = next.page
    await openPanel(page)
    await expect(page.getByRole('checkbox', { name: 'Enable margin comments' })).toBeChecked()
    await expect(page.getByRole('textbox', { name: 'LM Studio address' })).toHaveValue(mock.url)
    await expect(page.getByRole('spinbutton', { name: 'Max comments per day' })).toHaveValue('12')
    await expect(page.getByRole('spinbutton', { name: 'Pause before commenting (ms)' })).toHaveValue('3000')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a wrong URL scheme shows a clear error and AI stays off', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await openPanel(page)
    await setAddress(page, 'ftp://localhost:1234/v1')
    await page.getByRole('button', { name: 'Test connection' }).click()
    await expect(page.locator('[data-ai-settings-error="true"]')).toHaveText('Invalid AI address')
    await expect(page.getByRole('checkbox', { name: 'Enable margin comments' })).not.toBeChecked()
  } finally {
    await closeApp(app, userData)
  }
})

test('a stopped server shows the real connection error, not a vague failure', async () => {
  const mock = await startMockLmStudio()
  const url = mock.url
  await mock.close()
  const { app, page, userData } = await launchApp()
  try {
    await openPanel(page)
    await setAddress(page, url)
    await page.getByRole('button', { name: 'Test connection' }).click()
    const status = page.locator('[data-ai-connection="error"]')
    await expect(status).toContainText('Cannot reach')
    await expect(status).toContainText(url)
    await expect(page.getByRole('checkbox', { name: 'Enable margin comments' })).not.toBeChecked()
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
  }
})

test('a non-private address warns that task text would be sent there', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await openPanel(page)
    await setAddress(page, 'https://example.com/v1')
    await expect(page.locator('[data-ai-remote-note="true"]')).toContainText('would be sent')
    await setAddress(page, 'http://192.168.1.20:1234/v1')
    await expect(page.locator('[data-ai-remote-note="true"]')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
  }
})

test('with AI off, typing sends nothing and the notebook is unchanged', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const task = await writeTask(page, 'a task typed while AI is off')
    await page.waitForTimeout(3000)
    expect(mock.requests).toHaveLength(0)
    await expect(task).toHaveText('a task typed while AI is off')
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})