import "@fontsource-variable/atkinson-hyperlegible-next"
import React from "react"
import ReactDOM from "react-dom/client"
import { App } from "./App"
import "./styles.css"

const rootElement = document.querySelector("#root")
if (rootElement === null) throw new TypeError("Root element is missing")

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
