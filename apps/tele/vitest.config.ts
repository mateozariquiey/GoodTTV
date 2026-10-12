import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "tele",
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
