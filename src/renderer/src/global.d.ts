import type { AppApi } from "../../shared/contracts"

declare global {
  interface Window {
    readonly api: AppApi
  }
}
