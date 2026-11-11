import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { collapsedComments } from '../lib/margin-stack'
import { useAiComments } from '../store/ai-comments'
import { AiCommentBody } from './AiCommentBody'
import { AiCommentDot } from './AiCommentDot'

export const AiCommentNode = memo(function AiCommentNode({ id }: NodeProps) {
  const comment = useAiComments((state) => state.comments.find((item) => item.id === id))
  const collapsed = useAiComments((state) => collapsedComments(state.comments, state.marginShown).has(id))
  if (!comment || comment.status === 'resolved') return null
  return (
    <>
      {collapsed ? <AiCommentDot comment={comment} /> : <AiCommentBody id={id} />}
      {comment.status === 'open' ? (
        <Handle id="out" type="source" position={Position.Right} isConnectable={false} className="ai-handle" />
      ) : null}
    </>
  )
})
