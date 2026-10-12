import { defineConfig } from "vitest/config"

// Cada app y cada paquete tiene su propia configuración; `bun run test` las ejecuta todas.
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
  },
})
