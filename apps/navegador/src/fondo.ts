import { channelFromTwitchUrl } from "./twitch-links"

// Fondo de la extensión: abre la página de GoodTTV (o la trae al frente si ya está abierta) y pone «Abrir en GoodTTV»
// en el menú contextual de twitch.tv. Todo lo demás (directo, cuenta, chat) vive en la página, porque en Chrome el
// fondo es un service worker que el navegador puede detener.
const PAGE = chrome.runtime.getURL("goodttv.html")

// hash: la vista que abrir (#/canal/<login>). Si la página ya está abierta, solo cambia su dirección: no se recarga.
const openPage = async (hash = ""): Promise<void> => {
  // getContexts solo ve las páginas de la propia extensión, sin pedir el permiso «tabs». Si el navegador no lo tiene,
  // se abre otra pestaña (la página avisa de que ya hay una).
  const contexts =
    typeof chrome.runtime.getContexts === "function"
      ? await chrome.runtime.getContexts({ contextTypes: ["TAB"] })
      : []
  const open = contexts.find((context) => context.documentUrl?.startsWith(PAGE))
  if (open?.tabId !== undefined && open.tabId >= 0) {
    const tab = await chrome.tabs.update(open.tabId, {
      active: true,
      ...(hash === "" ? {} : { url: PAGE + hash }),
    })
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
    return
  }
  await chrome.tabs.create({ url: PAGE + hash })
}

// En los enlaces a twitch.tv de cualquier web y en las páginas de twitch.tv (sin tocar la página: no hay scripts de
// contenido). Fuera de la página de un canal, lleva a Inicio.
const createMenus = (): void => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      contexts: ["link"],
      id: "abrir-enlace",
      targetUrlPatterns: [
        "https://www.twitch.tv/*",
        "https://twitch.tv/*",
        "https://m.twitch.tv/*",
      ],
      title: "Abrir en GoodTTV",
    })
    chrome.contextMenus.create({
      contexts: ["page"],
      documentUrlPatterns: ["https://www.twitch.tv/*"],
      id: "abrir-pagina",
      title: "Abrir en GoodTTV",
    })
  })
}

chrome.contextMenus.onClicked.addListener((info) => {
  const login = channelFromTwitchUrl(info.linkUrl ?? info.pageUrl)
  void openPage(login === undefined ? "#/" : `#/canal/${login}`)
})
chrome.action.onClicked.addListener(() => void openPage())
chrome.runtime.onStartup.addListener(createMenus)
// Al instalarla se abre: así se ve que funciona, y las pruebas de Firefox encuentran la página.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  createMenus()
  if (reason === "install") void openPage()
})
