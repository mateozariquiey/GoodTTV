import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "servicios",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
