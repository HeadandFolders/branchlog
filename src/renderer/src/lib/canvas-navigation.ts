import type { WheelEvent as ReactWheelEvent } from 'react'
import { PanOnScrollMode, type ReactFlowProps } from '@xyflow/react'

type NavigationProps = Pick<
  ReactFlowProps,
  'panOnScroll' | 'panOnScrollMode' | 'panOnScrollSpeed' | 'zoomOnScroll' | 'zoomOnPinch' | 'zoomActivationKeyCode'
>

export function canvasNavigation(swipeToPan: boolean): NavigationProps {
  const mac = typeof navigator !== 'undefined' && navigator.userAgent.indexOf('Mac') >= 0
  return {
    panOnScroll: swipeToPan,
    panOnScrollMode: PanOnScrollMode.Free,
    panOnScrollSpeed: 1,
    zoomOnScroll: !swipeToPan,
    zoomOnPinch: true,
    zoomActivationKeyCode: mac ? 'Meta' : 'Control',
  }
}

function canScroll(element: HTMLElement, deltaX: number, deltaY: number): boolean {
  const style = getComputedStyle(element)
  const vertical = style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay'
  const horizontal = style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'overlay'
  if (vertical && element.scrollHeight > element.clientHeight + 1) {
    if (deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1) return true
    if (deltaY < 0 && element.scrollTop > 0) return true
  }
  if (horizontal && element.scrollWidth > element.clientWidth + 1) {
    if (deltaX > 0 && element.scrollLeft + element.clientWidth < element.scrollWidth - 1) return true
    if (deltaX < 0 && element.scrollLeft > 0) return true
  }
  return false
}

export function keepOwnScroll(event: ReactWheelEvent<HTMLDivElement>): void {
  const start = event.target
  if (!(start instanceof Node)) return
  const root = event.currentTarget
  let node: HTMLElement | null = start instanceof HTMLElement ? start : start.parentElement
  while (node && node !== root) {
    if (canScroll(node, event.deltaX, event.deltaY)) {
      node.classList.add('nowheel')
      return
    }
    node.classList.remove('nowheel')
    node = node.parentElement
  }
}
