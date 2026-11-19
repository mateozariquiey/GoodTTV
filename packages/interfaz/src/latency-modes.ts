import type { LatencyMode } from "@goodttv/contratos"
import { t } from "./idioma"

// Retraso del directo (reproductor propio). El chat se retrasa lo mismo para ir sincronizado con la imagen. Cada modo,
// con su nombre y su explicación, para los ajustes de las tres versiones (AccountScreen en la TV, SettingsView en la
// extensión y Cuenta en Android), en el orden de LATENCY_ORDER.
export const LATENCY_MODES: Record<LatencyMode, { readonly hint: string; readonly label: string }> =
  {
    adaptativo: {
      get hint() {
        return t(
          "Unos segundos de retraso. Si el canal pone una pausa publicitaria total, la primera para la imagen unos segundos y desde entonces se mantiene ~16 s por detrás para que las siguientes no se noten. Las pausas se cubren con la grabación del directo, si el canal la tiene pública.",
        )
      },
      get label() {
        return t("Adaptativo")
      },
    },
    directo: {
      get hint() {
        return t(
          "El mínimo retraso posible, para eventos en vivo. Si el canal pone una pausa publicitaria total, la imagen se queda quieta lo que dure y luego salta al directo.",
        )
      },
      get label() {
        return t("Directo")
      },
    },
    "sin-paradas": {
      get hint() {
        return t(
          "Unos 22 s por detrás desde el principio, para que las pausas publicitarias totales no detengan la imagen. Las cubre con la grabación del directo, si el canal la tiene pública.",
        )
      },
      get label() {
        return t("Sin paradas")
      },
    },
  }
export const LATENCY_ORDER: readonly LatencyMode[] = ["adaptativo", "sin-paradas", "directo"]
