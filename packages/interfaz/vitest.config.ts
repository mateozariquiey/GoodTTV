import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "interfaz",
    environment: "node", // las pruebas que necesitan DOM lo piden con @vitest-environment jsdom
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
