import { useState } from "react"

// «Reintentar» que espera a la respuesta: mientras, dice «Comprobando…» y no repite.
export const RetryButton = ({ onRetry }: { readonly onRetry: () => Promise<void> }) => {
  const [retrying, setRetrying] = useState(false)
  return (
    <button
      aria-busy={retrying}
      className="button"
      onClick={() => {
        if (retrying) return
        setRetrying(true)
        void onRetry().finally(() => setRetrying(false))
      }}
      type="button"
    >
      {retrying ? "Comprobando…" : "Reintentar"}
    </button>
  )
}
