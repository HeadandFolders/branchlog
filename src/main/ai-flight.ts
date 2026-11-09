type FlightCategory = 'auto' | 'user'

export interface AiFlight {
  category: FlightCategory
  requestId: string
  controller: AbortController
}

let autoFlight: AiFlight | null = null
let userFlight: AiFlight | null = null

function slot(category: FlightCategory): AiFlight | null {
  return category === 'auto' ? autoFlight : userFlight
}

function setSlot(category: FlightCategory, flight: AiFlight | null): void {
  if (category === 'auto') autoFlight = flight
  else userFlight = flight
}

export function startAiFlight(category: FlightCategory, requestId: string): AiFlight {
  slot(category)?.controller.abort()
  const flight: AiFlight = { category, requestId, controller: new AbortController() }
  setSlot(category, flight)
  return flight
}

export function isCurrentAiFlight(flight: AiFlight): boolean {
  // Identity, not just requestId: a reused ID must not revive an older request.
  return slot(flight.category) === flight && !flight.controller.signal.aborted
}

export function finishAiFlight(flight: AiFlight): void {
  if (slot(flight.category) === flight) setSlot(flight.category, null)
}

export function cancelAiFlight(category: FlightCategory, requestId?: string): void {
  const flight = slot(category)
  if (!flight || (requestId !== undefined && flight.requestId !== requestId)) return
  flight.controller.abort()
  setSlot(category, null)
}

export function cancelAiRequest(requestId: string): void {
  cancelAiFlight('auto', requestId)
  cancelAiFlight('user', requestId)
}

export function cancelAiFlights(): void {
  cancelAiFlight('auto')
  cancelAiFlight('user')
}
