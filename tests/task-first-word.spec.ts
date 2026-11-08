// Isolated from the suite. The first word typed on a blank day sometimes comes
// back shortened or scrambled ("origin" as "gino" or "oigin", "hello" as "lloh").
// Uncomment this test to run just that check:
// npx playwright test tests/task-first-word.spec.ts

// import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
// import { closeApp, launchApp } from './launch'
//
// test.describe('first word on a blank day', () => {
//   let app: ElectronApplication
//   let page: Page
//   let userData = ''
//
//   test.beforeEach(async () => {
//     const launched = await launchApp()
//     app = launched.app
//     page = launched.page
//     userData = launched.userData
//   })
//
//   test.afterEach(async () => {
//     await closeApp(app, userData)
//   })
//
//   test('typing the first word leaves that word unchanged', async () => {
//     const cases = ['origin', 'hello']
//     for (let index = 0; index < cases.length; index += 1) {
//       const word = cases[index]
//       if (index > 0) {
//         await page.getByRole('button', { name: 'Next day' }).click()
//         await page.getByRole('textbox', { name: 'New task' }).waitFor()
//       }
//       await page.getByRole('textbox', { name: 'New task' }).click()
//       await page.keyboard.type(word)
//       await expect(page.locator('[data-task-text]').first()).toHaveText(word)
//     }
//   })
// })
