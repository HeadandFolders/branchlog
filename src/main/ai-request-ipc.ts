import { ipcMain } from 'electron'
import { askAi } from './ai-ask'
import { requestComment, replyToComment } from './ai-comment'
import { cancelAiRequest } from './ai-flight'
import { parseAiCancel, parseAskAiInput, parseCommentReply, parseCommentRequest } from './validate'

export function installAiRequestIpc(): void {
  ipcMain.handle('ai:requestComment', async (_event, payload: unknown) => {
    try {
      return await requestComment(parseCommentRequest(payload))
    } catch (error) {
      console.error('ai:requestComment', error)
      return { kind: 'none' }
    }
  })

  ipcMain.handle('ai:ask', async (_event, payload: unknown) => {
    try {
      return await askAi(parseAskAiInput(payload))
    } catch (error) {
      console.error('ai:ask', error)
      return { kind: 'none' }
    }
  })

  ipcMain.handle('ai:reply', async (_event, payload: unknown) => {
    try {
      return await replyToComment(parseCommentReply(payload))
    } catch (error) {
      console.error('ai:reply', error)
      return { kind: 'none' }
    }
  })

  ipcMain.on('ai:cancel', (_event, payload: unknown) => {
    try {
      cancelAiRequest(parseAiCancel(payload))
    } catch (error) {
      console.error('ai:cancel', error)
    }
  })
}
