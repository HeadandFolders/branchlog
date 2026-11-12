import { expect, test } from '@playwright/test'
import {
  BODY_TOKEN_MULTIPLIER,
  TOOL_MODE_MIN_TOKENS,
  bodyTokenBudget,
  estimatePromptTokens,
  estimateTextTokens,
  toolModeMaxTokens,
} from '../src/shared/ai-budget'

test('characters become tokens at four to one, rounded up', () => {
  expect(estimateTextTokens('')).toBe(0)
  expect(estimateTextTokens('abcd')).toBe(1)
  expect(estimateTextTokens('abcde')).toBe(2)
  expect(estimatePromptTokens([{ content: 'abcd' }, { content: 'abcdefghij' }])).toBe(4)
})

test('the body budget is the answer cap in tokens times the multiplier, with a floor', () => {
  expect(bodyTokenBudget(8_000)).toBe(2_000 * BODY_TOKEN_MULTIPLIER)
  expect(TOOL_MODE_MIN_TOKENS).toBe(1_024)
  expect(toolModeMaxTokens({ answerMaxChars: 500, promptTokens: 10, modelContextTokens: 131_072 })).toBe(
    TOOL_MODE_MIN_TOKENS,
  )
})

test('the clamp keeps prompt tokens plus max_tokens inside the loaded context', () => {
  const filled = toolModeMaxTokens({ answerMaxChars: 40_000, promptTokens: 6_000, modelContextTokens: 8_192 })
  expect(filled).toBe(2_192)
  expect(6_000 + filled).toBeLessThanOrEqual(8_192)
})

test('a prompt that already fills the context still gets a positive budget', () => {
  expect(toolModeMaxTokens({ answerMaxChars: 8_000, promptTokens: 8_192, modelContextTokens: 8_192 })).toBe(1)
  expect(toolModeMaxTokens({ answerMaxChars: 8_000, promptTokens: 20_000, modelContextTokens: 8_192 })).toBe(1)
})
