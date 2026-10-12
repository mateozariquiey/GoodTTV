import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "navegador",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
