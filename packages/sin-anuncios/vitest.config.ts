import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "sin-anuncios",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
