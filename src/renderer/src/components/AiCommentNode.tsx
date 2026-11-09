import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useAiComments } from '../store/ai-comments'
import { AiCommentBody } from './AiCommentBody'

export const AiCommentNode = memo(function AiCommentNode({ id }: NodeProps) {
  const open = useAiComments((state) => state.comments.some((item) => item.id === id && item.status === 'open'))
  return (
    <>
      <AiCommentBody id={id} />
      {open ? <Handle id="out" type="source" position={Position.Right} isConnectable={false} className="ai-handle" /> : null}
    </>
  )
})
