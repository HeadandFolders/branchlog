import type { ImageCrop } from '@shared/types'

export const MIN_CROP_VISIBLE = 0.05
export const MIN_CROP_SIZE = 16

export type CropSide = 'left' | 'top' | 'right' | 'bottom'

export interface CropBox extends ImageCrop {
  x: number
  y: number
  width: number
  height: number
}

export function cropBoxOf(image: CropBox): CropBox {
  return {
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
    cropLeft: image.cropLeft,
    cropTop: image.cropTop,
    cropRight: image.cropRight,
    cropBottom: image.cropBottom,
  }
}

export function cropImageStyle(crop: ImageCrop): { width: string; height: string; left: string; top: string } {
  const fw = Math.max(MIN_CROP_VISIBLE, 1 - crop.cropLeft - crop.cropRight)
  const fh = Math.max(MIN_CROP_VISIBLE, 1 - crop.cropTop - crop.cropBottom)
  return {
    width: `${(100 / fw).toFixed(4)}%`,
    height: `${(100 / fh).toFixed(4)}%`,
    left: `${((-100 * crop.cropLeft) / fw).toFixed(4)}%`,
    top: `${((-100 * crop.cropTop) / fh).toFixed(4)}%`,
  }
}

function clampFraction(value: number, other: number): number {
  return Math.min(1 - MIN_CROP_VISIBLE - other, Math.max(0, value))
}

function dragAxis(
  box: CropBox,
  leading: boolean,
  horizontal: boolean,
  delta: number,
  insetNear: number,
  insetFar: number,
): CropBox {
  const size = horizontal ? box.width : box.height
  const pos = horizontal ? box.x : box.y
  const full = size / Math.max(MIN_CROP_VISIBLE, 1 - insetNear - insetFar)
  const grow = leading ? -delta : delta
  const next = Math.min(full * (1 - insetFar), Math.max(MIN_CROP_SIZE, full * MIN_CROP_VISIBLE, size + grow))
  const inset = clampFraction(1 - insetFar - next / full, insetFar)
  const shifted = leading ? pos + (size - next) : pos
  const patch = horizontal
    ? { x: shifted, width: next, ...(leading ? { cropLeft: inset } : { cropRight: inset }) }
    : { y: shifted, height: next, ...(leading ? { cropTop: inset } : { cropBottom: inset }) }
  return { ...box, ...patch }
}

export function dragCrop(box: CropBox, side: CropSide, delta: number): CropBox {
  if (side === 'left') return dragAxis(box, true, true, delta, box.cropLeft, box.cropRight)
  if (side === 'right') return dragAxis(box, false, true, delta, box.cropRight, box.cropLeft)
  if (side === 'top') return dragAxis(box, true, false, delta, box.cropTop, box.cropBottom)
  return dragAxis(box, false, false, delta, box.cropBottom, box.cropTop)
}

export function commitCropBox(start: CropBox, side: CropSide, delta: number): CropBox {
  const next = dragCrop(start, side, delta)
  const width = Math.max(MIN_CROP_SIZE, Math.round(next.width))
  const height = Math.max(MIN_CROP_SIZE, Math.round(next.height))
  const fullWidth = start.width / Math.max(MIN_CROP_VISIBLE, 1 - start.cropLeft - start.cropRight)
  const fullHeight = start.height / Math.max(MIN_CROP_VISIBLE, 1 - start.cropTop - start.cropBottom)
  const cropLeft = side === 'left' ? clampFraction(1 - start.cropRight - width / fullWidth, start.cropRight) : next.cropLeft
  const cropRight = side === 'right' ? clampFraction(1 - start.cropLeft - width / fullWidth, start.cropLeft) : next.cropRight
  const cropTop = side === 'top' ? clampFraction(1 - start.cropBottom - height / fullHeight, start.cropBottom) : next.cropTop
  const cropBottom = side === 'bottom' ? clampFraction(1 - start.cropTop - height / fullHeight, start.cropTop) : next.cropBottom
  const x = side === 'left' ? start.x + (start.width - width) : next.x
  const y = side === 'top' ? start.y + (start.height - height) : next.y
  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
    cropLeft: floor4(cropLeft),
    cropTop: floor4(cropTop),
    cropRight: floor4(cropRight),
    cropBottom: floor4(cropBottom),
  }
}

function floor4(value: number): number {
  return Math.floor(value * 10_000) / 10_000
}
