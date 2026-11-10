import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "tv",
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
