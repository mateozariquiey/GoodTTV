import type { AppApi } from "@goodttv/contratos"

declare global {
  interface Window {
    readonly api: AppApi
  }
}
