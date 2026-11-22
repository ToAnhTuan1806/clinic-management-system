import { test } from '@playwright/test'
import { runHistoryMock } from './history-mock-runner.mjs'

test('D11 MOCK ONLY — medical history UI, release, and roles', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000)
  const origin = baseURL || 'http://127.0.0.1:5174'
  await runHistoryMock(page, origin)
})
