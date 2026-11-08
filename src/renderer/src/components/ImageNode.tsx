import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useImages } from '../store/images'
import { tempCountRender } from '../temp-first-paint'

export const ImageNode = memo(function ImageNode({ id }: NodeProps) {
  tempCountRender('ImageNode')
  const image = useImages((state) => state.images.find((item) => item.id === id))
  if (!image) return null
  return (
    <div className="canvas-image nopan">
      <img src={image.src} alt="" draggable={false} />
    </div>
  )
})
