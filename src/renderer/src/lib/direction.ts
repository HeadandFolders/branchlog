const RTL = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/
const LTR = /[A-Za-z\u00C0-\u02B8\u0370-\u03FF\u0400-\u052F]/

export function textDirection(text: string): 'ltr' | 'rtl' {
  const rtl = text.search(RTL)
  const ltr = text.search(LTR)
  if (rtl === -1) return 'ltr'
  if (ltr === -1) return 'rtl'
  return rtl < ltr ? 'rtl' : 'ltr'
}
