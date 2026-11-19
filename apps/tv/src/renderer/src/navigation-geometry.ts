// Spatial focus: which control does an arrow key lead to?
//
// Candidates that overlap the current control across the direction of travel (its "beam") win:
// pressing → on a button should reach the control beside it, not one that is diagonally closer.
// Among them, the nearest edge wins; ties go to the best centred. Only when nothing is in the
// beam does the nearest control in that direction win, weighing misalignment double.

export const FOCUS_DIRECTIONS = ["down", "left", "right", "up"] as const
export type FocusDirection = (typeof FOCUS_DIRECTIONS)[number]

export type FocusCandidate = {
  readonly bottom: number
  readonly id: string
  readonly left: number
  readonly right: number
  readonly top: number
}

const horizontal = (direction: FocusDirection): boolean =>
  direction === "left" || direction === "right"

// Gap between the facing edges along the direction of travel; negative means "not ahead".
const gapAhead = (from: FocusCandidate, to: FocusCandidate, direction: FocusDirection): number => {
  switch (direction) {
    case "down":
      return to.top - from.bottom
    case "up":
      return from.top - to.bottom
    case "right":
      return to.left - from.right
    case "left":
      return from.left - to.right
  }
}

// Distance between the two boxes across the direction of travel; 0 when they overlap.
const offAxis = (from: FocusCandidate, to: FocusCandidate, direction: FocusDirection): number => {
  const [fromStart, fromEnd, toStart, toEnd] = horizontal(direction)
    ? [from.top, from.bottom, to.top, to.bottom]
    : [from.left, from.right, to.left, to.right]
  return Math.max(0, toStart - fromEnd, fromStart - toEnd)
}

const centreOffset = (from: FocusCandidate, to: FocusCandidate, direction: FocusDirection) =>
  horizontal(direction)
    ? Math.abs(to.top + to.bottom - from.top - from.bottom) / 2
    : Math.abs(to.left + to.right - from.left - from.right) / 2

export const chooseNextFocus = (
  current: FocusCandidate | undefined,
  candidates: readonly FocusCandidate[],
  direction: FocusDirection,
): FocusCandidate | undefined => {
  if (current === undefined) return candidates[0]
  // Allow a pixel of overlap so neighbours that touch or overlap by rounding still count.
  const ahead = candidates.filter(
    (candidate) => candidate.id !== current.id && gapAhead(current, candidate, direction) >= -1,
  )
  const inBeam = ahead.filter((candidate) => offAxis(current, candidate, direction) === 0)
  const pool = inBeam.length > 0 ? inBeam : ahead
  const score = (candidate: FocusCandidate): number =>
    inBeam.length > 0
      ? gapAhead(current, candidate, direction) + centreOffset(current, candidate, direction) / 1000
      : gapAhead(current, candidate, direction) + 2 * offAxis(current, candidate, direction)
  return [...pool].sort((left, right) => score(left) - score(right))[0]
}
