import { memo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { CanvasImage } from '@shared/types'
import { pushImageHistory } from '../store/history'
import { useImages } from '../store/images'
import { layoutAfterWrite, layoutBeforeWrite } from '../store/layout-bridge'
import { useNotebook } from '../store/notebook'
import {
  commitCropBox,
  cropBoxOf,
  cropImageStyle,
  dragCrop,
  type CropBox,
  type CropSide,
} from '../lib/image-crop'

const SIDES: readonly CropSide[] = ['left', 'top', 'right', 'bottom']

interface CropDrag {
  side: CropSide
  start: CropBox
  fromX: number
  fromY: number
  zoom: number
}

function deltaOf(drag: CropDrag, event: ReactPointerEvent): number {
  const screen =
    drag.side === 'left' || drag.side === 'right' ? event.clientX - drag.fromX : event.clientY - drag.fromY
  return screen / drag.zoom
}

export const ImageCrop = memo(function ImageCrop({ image }: { image: CanvasImage }) {
  const { getZoom } = useReactFlow()
  const drag = useRef<CropDrag | null>(null)
  const [preview, setPreview] = useState<CropBox | null>(null)
  const shown = preview ?? cropBoxOf(image)

  const onPointerDown = (side: CropSide) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    drag.current = {
      side,
      start: cropBoxOf(image),
      fromX: event.clientX,
      fromY: event.clientY,
      zoom: getZoom() || 1,
    }
    setPreview(drag.current.start)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current) return
    setPreview(dragCrop(current.start, current.side, deltaOf(current, event)))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current
    drag.current = null
    setPreview(null)
    if (!current) return
    const final = commitCropBox(current.start, current.side, deltaOf(current, event))
    const id = image.id
    const phase = layoutBeforeWrite(id)
    const before = useImages.getState().images.map((item) => ({ ...item }))
    useImages.getState().resize(id, final.x, final.y, final.width, final.height, final)
    pushImageHistory(before, useImages.getState().images)
    const wrote = window.branchlog.images.resizeSync({ id, ...final })
    if (!wrote.ok) useNotebook.setState({ error: 'Could not save that crop.' })
    if (phase === 'defer') layoutAfterWrite()
  }

  const frameStyle: CSSProperties = preview
    ? {
        left: preview.x - image.x,
        top: preview.y - image.y,
        width: preview.width,
        height: preview.height,
        right: 'auto',
        bottom: 'auto',
      }
    : {}

  return (
    <>
      <div className="canvas-image-frame" style={frameStyle}>
        <img src={image.src} alt="" draggable={false} style={cropImageStyle(shown)} />
      </div>
      {SIDES.map((side) => (
        <div
          key={side}
          role="separator"
          aria-label={`Crop from the ${side}`}
          className={`image-crop-handle image-crop-${side} nodrag nopan`}
          onPointerDown={onPointerDown(side)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ))}
    </>
  )
})
