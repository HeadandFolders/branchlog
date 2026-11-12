export type SaveFileArguments = {
  content: string
  suggestedName?: string
}

export interface ToolParameterSchema {
  type: 'object'
  properties: Record<string, { type: string }>
  required: string[]
  additionalProperties: false
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ToolParameterSchema
  }
}

export const SAVE_FILE_NAME = 'save_file'

// The definition only. Nothing here writes: the app saves a file when the person clicks Save.
export const SAVE_FILE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: SAVE_FILE_NAME,
    description:
      'Hand over a finished text document. Put the whole body in content, never in your prose, and suggest a short file name when you can.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        suggestedName: { type: 'string' },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
}
