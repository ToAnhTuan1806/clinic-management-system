import { test } from '@playwright/test'
import { runDirectoryMock } from './directory-mock-runner.mjs'

test('MOCK ONLY — D03 directory and roles, no real API', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000)
  await page.goto(`${baseURL}/login`)
  await page
    .getByRole('heading', { name: 'Chào mừng trở lại', level: 1 })
    .waitFor()
  await runDirectoryMock(page)
})
