import { memo } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { Axe } from 'lucide-react'
import { layoutAfterWrite, layoutBeforeWrite } from '../store/layout-bridge'
import { pushImageHistory } from '../store/history'
import { useImages } from '../store/images'
import { useNotebook } from '../store/notebook'
import { tempCountRender } from '../temp-first-paint'
import { ImageCrop } from './ImageCrop'

const MIN_IMAGE_SIZE = 16

export const ImageNode = memo(function ImageNode({ id, selected }: NodeProps) {
  tempCountRender('ImageNode')
  const image = useImages((state) => state.images.find((item) => item.id === id))
  if (!image) return null
  const crop = {
    cropLeft: image.cropLeft,
    cropTop: image.cropTop,
    cropRight: image.cropRight,
    cropBottom: image.cropBottom,
  }
  return (
    <div className="canvas-image nopan">
      <NodeResizer
        isVisible={selected === true}
        keepAspectRatio
        minWidth={MIN_IMAGE_SIZE}
        minHeight={MIN_IMAGE_SIZE}
        handleClassName="image-resize-handle"
        lineClassName="image-resize-line"
        onResizeEnd={(_event, params) => {
          const x = Math.round(params.x)
          const y = Math.round(params.y)
          const width = Math.max(MIN_IMAGE_SIZE, Math.round(params.width))
          const height = Math.max(MIN_IMAGE_SIZE, Math.round(params.height))
          const phase = layoutBeforeWrite(id)
          const before = useImages.getState().images.map((item) => ({ ...item }))
          useImages.getState().resize(id, x, y, width, height, crop)
          pushImageHistory(before, useImages.getState().images)
          const wrote = window.branchlog.images.resizeSync({ id, x, y, width, height, ...crop })
          if (!wrote.ok) useNotebook.setState({ error: 'Could not save that size.' })
          if (phase === 'defer') layoutAfterWrite()
        }}
      />
      <ImageCrop image={image} active={selected === true} />
      {selected === true && (
        <button
          type="button"
          className="image-delete nodrag nopan"
          aria-label="Delete image"
          onClick={() => useImages.getState().remove([id])}
        >
          <Axe size={13} />
        </button>
      )}
    </div>
  )
})
