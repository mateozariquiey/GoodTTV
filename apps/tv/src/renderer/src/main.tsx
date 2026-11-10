import "@fontsource-variable/atkinson-hyperlegible-next"
import { App, activarIdioma, type IdiomaElegido } from "@goodttv/interfaz"
import React from "react"
import ReactDOM from "react-dom/client"
import "@goodttv/interfaz/styles.css"

// El idioma (D35), antes de pintar nada: lo elegido y el del sistema llegan ya leídos de main (window.api.idioma). Sin
// ellos, el localStorage y el idioma de Chromium.
const { idioma } = window.api
let elegido: IdiomaElegido | undefined = idioma?.elegido
activarIdioma(
  idioma === undefined
    ? undefined
    : {
        guardar: (valor) => {
          elegido = valor
          void idioma.elegir(valor).catch(() => undefined) // sin guardar, vale hasta cerrar la app
        },
        leer: () => elegido ?? null,
        sistema: () => idioma.sistema,
      },
)

const rootElement = document.querySelector("#root")
if (rootElement === null) throw new TypeError("Root element is missing")

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
