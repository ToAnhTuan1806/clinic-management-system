import { test } from '@playwright/test'
import { runAuthMockQA } from './auth-mock-runner.mjs'

test('MOCK ONLY — auth UI, roles and memory session', async ({ page }) => {
  test.setTimeout(180_000)
  await runAuthMockQA(page)
})
