import "@fontsource-variable/atkinson-hyperlegible-next"
import { App } from "@goodttv/interfaz"
import React from "react"
import ReactDOM from "react-dom/client"
import "@goodttv/interfaz/styles.css"

const rootElement = document.querySelector("#root")
if (rootElement === null) throw new TypeError("Root element is missing")

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
