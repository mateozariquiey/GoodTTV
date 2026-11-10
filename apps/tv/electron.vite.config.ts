import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import { licencias } from "../../licencias-vite.mjs"

export default defineConfig({
  main: { plugins: [licencias()] },
  preload: {
    build: {
      rollupOptions: {
        external: ["electron"],
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react(), licencias()],
  },
})
