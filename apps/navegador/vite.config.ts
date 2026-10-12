import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { licencias } from "../../licencias-vite.mjs"

// Una sola compilación para Chrome y Firefox (dist/): las páginas de la extensión y su fondo, que debe quedar en un
// archivo propio sin importaciones (el manifest lo carga como service worker en Chrome y como script en Firefox).
// Sin minificar: se carga desde el disco, así que el tamaño no importa y los errores se leen mejor.
const src = (path: string): string => new URL(`./src/${path}`, import.meta.url).pathname

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 4000,
    emptyOutDir: true,
    minify: false,
    outDir: "../dist",
    rolldownOptions: {
      input: {
        fondo: src("fondo.ts"),
        goodttv: src("goodttv.html"),
        reproductor: src("reproductor.html"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "fondo" ? "fondo.js" : "assets/[name]-[hash].js",
      },
    },
  },
  plugins: [react(), licencias()],
  publicDir: "../public",
  root: "src",
})
