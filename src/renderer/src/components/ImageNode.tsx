import { memo, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { layoutAfterWrite, layoutBeforeWrite } from '../store/layout-bridge'
import { pushImageHistory } from '../store/history'
import { useImages } from '../store/images'
import { useNotebook } from '../store/notebook'
import { tempCountRender } from '../temp-first-paint'
import { cropImageStyle } from '../lib/image-crop'
import { ImageCrop } from './ImageCrop'

const MIN_IMAGE_SIZE = 16

export const ImageNode = memo(function ImageNode({ id, selected }: NodeProps) {
  tempCountRender('ImageNode')
  const image = useImages((state) => state.images.find((item) => item.id === id))
  const [cropMode, setCropMode] = useState(false)
  if (!image) return null
  const crop = {
    cropLeft: image.cropLeft,
    cropTop: image.cropTop,
    cropRight: image.cropRight,
    cropBottom: image.cropBottom,
  }
  return (
    <div className={`canvas-image nopan${cropMode ? ' crop-mode' : ''}`}>
      <NodeResizer
        isVisible={selected === true && !cropMode}
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
      {cropMode ? (
        <ImageCrop image={image} />
      ) : (
        <div className="canvas-image-frame">
          <img src={image.src} alt="" draggable={false} style={cropImageStyle(image)} />
        </div>
      )}
      <button
        type="button"
        className="image-crop-toggle"
        aria-pressed={cropMode}
        onClick={() => setCropMode((mode) => !mode)}
      >
        {cropMode ? 'Done' : 'Crop'}
      </button>
    </div>
  )
})
