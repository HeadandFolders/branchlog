// Budgeting for a model that emits no schema: the whole completion is body, so the only number
// that keeps a deliverable from dying at finish_reason 'length' is max_tokens.
export const TOOL_MODE_MIN_TOKENS = 1024
export const BODY_TOKEN_MULTIPLIER = 3
const CHARS_PER_TOKEN = 4

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimatePromptTokens(messages: readonly { content: string }[]): number {
  let total = 0
  for (const message of messages) total += estimateTextTokens(message.content)
  return total
}

export function bodyTokenBudget(answerMaxChars: number): number {
  return Math.ceil(answerMaxChars / CHARS_PER_TOKEN) * BODY_TOKEN_MULTIPLIER
}

// The floor is not a guarantee: a prompt that already fills the context leaves nothing to give the
// body, and one token is the honest answer to that.
export function toolModeMaxTokens(input: {
  answerMaxChars: number
  promptTokens: number
  modelContextTokens: number
}): number {
  const desired = Math.max(TOOL_MODE_MIN_TOKENS, bodyTokenBudget(input.answerMaxChars))
  const headroom = input.modelContextTokens - input.promptTokens
  return Math.max(1, Math.min(desired, headroom))
}
