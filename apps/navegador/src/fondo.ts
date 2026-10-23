import type { TabFound, TabQuery } from "./pestanas"
import { channelFromTwitchUrl } from "./twitch-links"

// Fondo de la extensión: abre GoodTTV y pone «Abrir en GoodTTV» en el menú contextual de twitch.tv. Todo lo demás
// (directo, cuenta, chat) vive en la página, porque en Chrome el fondo es un service worker que el navegador puede
// detener.
const PAGE = chrome.runtime.getURL("goodttv.html")

const isTabFound = (value: unknown): value is TabFound =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as TabFound).tabId === "number" &&
  typeof (value as TabFound).windowId === "number"

// La pestaña de GoodTTV que ya muestra esa vista, si la hay (pestanas.ts). Sin páginas abiertas, sendMessage falla.
const findTab = async (query: TabQuery) => {
  try {
    const found: unknown = await chrome.runtime.sendMessage(query)
    return isTabFound(found) ? found : undefined
  } catch {
    return undefined
  }
}

// login: el canal que abrir; sin él, Inicio. Varias pestañas a la vez (EXT-5): si una ya lo muestra, se trae al frente;
// si no, se abre otra, junto a la pestaña desde la que se pidió.
// Las pestañas recién abiertas por vista, unos segundos: mientras cargan aún no contestan a findTab, y dos pulsaciones
// seguidas abrirían dos.
const OPENING_MS = 5000
const opening = new Map<string, { readonly at: number; readonly tab: Promise<chrome.tabs.Tab> }>()

const focus = async (tabId: number, windowId: number): Promise<void> => {
  await chrome.tabs.update(tabId, { active: true })
  await chrome.windows.update(windowId, { focused: true })
}

const recentlyOpened = (view: string): Promise<chrome.tabs.Tab> | undefined => {
  const pending = opening.get(view)
  return pending !== undefined && Date.now() - pending.at < OPENING_MS ? pending.tab : undefined
}

const openPage = async (login: string | undefined, from?: chrome.tabs.Tab): Promise<void> => {
  const view = login ?? ""
  const pending = recentlyOpened(view)
  if (pending !== undefined) {
    const tab = await pending.catch(() => undefined)
    if (tab?.id !== undefined) return focus(tab.id, tab.windowId)
  }
  const found = await findTab({ goodttv: "busca", login: login ?? null })
  if (found !== undefined) return focus(found.tabId, found.windowId)
  if (recentlyOpened(view) !== undefined) return // otra pulsación la abrió mientras se buscaba
  const beside =
    from?.id !== undefined && from.id >= 0
      ? { index: from.index + 1, openerTabId: from.id, windowId: from.windowId }
      : {}
  const tab = chrome.tabs.create({
    url: PAGE + (login === undefined ? "#/" : `#/canal/${login}`),
    ...beside,
  })
  opening.set(view, { at: Date.now(), tab })
  await tab
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void openPage(channelFromTwitchUrl(info.linkUrl ?? info.pageUrl), tab)
})
chrome.action.onClicked.addListener((tab) => void openPage(undefined, tab))
chrome.runtime.onStartup.addListener(createMenus)
// Al instalarla se abre: así se ve que funciona, y las pruebas de Firefox encuentran la página.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  createMenus()
  if (reason === "install") void openPage(undefined)
})
