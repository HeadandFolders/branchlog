export const REQUEST_MARKER = '@r'

export interface RequestSplit {
  isRequest: boolean
  body: string
}

// Only a leading marker counts, and only followed by a space or a line break: "@r draft" is a
// request, "@read the notes" and a bare "@r" are not.
export function splitRequestPrefix(text: string): RequestSplit {
  if (!text.startsWith(REQUEST_MARKER)) return { isRequest: false, body: text }
  const after = text.slice(REQUEST_MARKER.length)
  const delimiter = after.charAt(0)
  if (delimiter !== ' ' && delimiter !== '\n') return { isRequest: false, body: text }
  return { isRequest: true, body: after.slice(1) }
}

export function isRequestText(text: string): boolean {
  const split = splitRequestPrefix(text)
  return split.isRequest && split.body.trim() !== ''
}

export function stripRequestPrefix(text: string): string {
  return splitRequestPrefix(text).body
}
