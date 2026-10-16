import "@fontsource-variable/atkinson-hyperlegible-next"
import { type Platform, PlatformContext } from "@goodttv/interfaz"
import { createDirecto } from "@goodttv/sin-anuncios"
import { FetchLoader } from "hls.js"
import { StrictMode, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { createExtensionApi } from "./api"
import { installDirectoFetch } from "./directo-fetch"
import { Desktop } from "./escritorio/Desktop"
import { pageStorage, readSavedHome } from "./home-cache"
import { labApi, labOptions } from "./lab"
import "./escritorio/desktop.css"

// La página de GoodTTV en la extensión: las pantallas de escritorio (escritorio/), con su window.api (api.ts) y el
// directo sin anuncios atendido en la propia página (directo-fetch.ts).

// El reproductor de @goodttv/interfaz, con el FetchLoader de hls.js para que sus peticiones a /stream/ pasen por la
// página, e Inicio de la última vez, que se lee sin esperar (home-cache.ts).
const PLATFORM: Platform = {
  hls: { loader: FetchLoader },
  savedHome: () => readSavedHome(pageStorage()),
}

const element = document.querySelector("#root")
if (element === null) throw new TypeError("Root element is missing")
const root = createRoot(element)

const start = (): void => {
  installDirectoFetch(createDirecto(labOptions(location.search)))
  Object.defineProperty(window, "api", { value: labApi(createExtensionApi(), location.search) })
  root.render(
    <StrictMode>
      <PlatformContext value={PLATFORM}>
        <Desktop />
      </PlatformContext>
    </StrictMode>,
  )
}

const Busy = ({ onTake }: { readonly onTake: () => void }) => {
  const [waiting, setWaiting] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => button.current?.focus(), [])
  if (waiting) return <main className="busy">Esperando a que la otra pestaña lo deje…</main>
  return (
    <main className="busy">
      <p>GoodTTV ya está abierto en otra pestaña.</p>
      <button
        className="button button--primary"
        onClick={() => {
          setWaiting(true)
          onTake()
        }}
        ref={button}
        type="button"
      >
        Usarlo aquí
      </button>
    </main>
  )
}

// Una sola GoodTTV a la vez: dos pestañas renovarían a la vez la misma sesión de Twitch (el token de renovación solo
// vale una vez) y abrirían dos chats. La pestaña que la tiene conserva el bloqueo hasta cerrarse. Si otra la pide, se
// pone a la cola y avisa; la primera se recarga (queda en espera) y suelta el bloqueo al descargarse, así que la nueva
// no arranca hasta que la anterior ha parado.
const LOCK = "goodttv"
const channel = new BroadcastChannel(LOCK)

const run = async (): Promise<void> => {
  channel.onmessage = (event) => {
    if (event.data === "cede") location.reload()
  }
  start()
  await new Promise(() => undefined)
}

const take = (): void => {
  void navigator.locks.request(LOCK, run)
  channel.postMessage("cede")
}

void navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
  if (lock === null) root.render(<Busy onTake={take} />)
  else await run()
})
