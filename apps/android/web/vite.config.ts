import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Las páginas de la app, compiladas para los assets del APK: la de la WebView visible (index.html) y la del motor del
// directo para Media3 (motor.html, Motor.kt). Las compila Gradle con el Vite de la raíz del monorepo
// (app/build.gradle.kts), que le da la carpeta de salida. Sin minificar, como la extensión: se cargan del propio APK y
// los errores se leen mejor.
const root = new URL(".", import.meta.url).pathname

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 4000,
    emptyOutDir: true,
    minify: false,
    rolldownOptions: {
      input: { index: `${root}index.html`, motor: `${root}motor.html` },
      // hls.js no se usa en Android (el vídeo es Media3, D21), pero llegaba al paquete por el índice de
      // @goodttv/interfaz, que exporta el reproductor de la extensión y la TV: hls.js no declara que no tiene efectos
      // al importarlo, así que se conservaba entero (1,1 MB) aunque nada lo llame. Si algo de Android lo usa, entra.
      treeshake: {
        moduleSideEffects: [{ sideEffects: false, test: /[\\/]node_modules[\\/]hls\.js[\\/]/ }],
      },
    },
  },
  plugins: [react()],
  root,
})
