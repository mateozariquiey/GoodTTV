import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react"

// Retroceder o avanzar unos segundos, como ← y →: la flecha en círculo con los segundos dentro.
export const SKIP_S = 10

export const SkipButton = ({
  disabled = false,
  forward,
  onSkip,
}: {
  readonly disabled?: boolean
  readonly forward: boolean
  readonly onSkip: () => void
}) => (
  <button
    aria-label={forward ? `Avanzar ${SKIP_S} s` : `Retroceder ${SKIP_S} s`}
    className="icon-button icon-button--light skip"
    disabled={disabled}
    onClick={onSkip}
    title={forward ? `Avanzar ${SKIP_S} s (→)` : `Retroceder ${SKIP_S} s (←)`}
    type="button"
  >
    {forward ? (
      <ArrowClockwiseIcon aria-hidden="true" />
    ) : (
      <ArrowCounterClockwiseIcon aria-hidden="true" />
    )}
    <span aria-hidden="true" className="skip__seconds">
      {SKIP_S}
    </span>
  </button>
)
