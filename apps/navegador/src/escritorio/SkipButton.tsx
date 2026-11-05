import { t } from "@goodttv/interfaz"
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
    aria-label={forward ? t("Avanzar {n} s", { n: SKIP_S }) : t("Retroceder {n} s", { n: SKIP_S })}
    className="icon-button icon-button--light skip"
    disabled={disabled}
    onClick={onSkip}
    title={
      forward ? t("Avanzar {n} s (→)", { n: SKIP_S }) : t("Retroceder {n} s (←)", { n: SKIP_S })
    }
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
