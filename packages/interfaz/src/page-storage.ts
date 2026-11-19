// El almacenamiento de la página (localStorage o, con session, sessionStorage), sin lanzar: lo que se guarda ahí (el
// volumen, la calidad, por dónde va cada VOD, los minutos por canal...) es una comodidad, y si el navegador no lo deja
// usar, la página sigue igual, solo que sin recordarlo. Leer globalThis.localStorage lanza si el navegador lo tiene
// bloqueado (con las cookies desactivadas, por ejemplo), y guardar lanza sin sitio (QuotaExceededError).
// Las funciones de cada módulo reciben el almacenamiento como parámetro, por defecto pageStorage(), para probarlas con
// uno en memoria. Aquí es obligatorio: undefined es que no hay, y no se va a buscar el de la página.
export const pageStorage = (session = false): Storage | undefined => {
  try {
    return session ? globalThis.sessionStorage : globalThis.localStorage
  } catch {
    return undefined
  }
}

// Lo guardado con esa clave; null si no hay nada o no se puede leer.
export const readStored = (key: string, storage: Storage | undefined): string | null => {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

// Sin almacenamiento o sin sitio, no se guarda: vale hasta recargar.
export const writeStored = (key: string, value: string, storage: Storage | undefined): void => {
  try {
    storage?.setItem(key, value)
  } catch {
    // Sin sitio: vale hasta recargar.
  }
}

export const removeStored = (key: string, storage: Storage | undefined): void => {
  try {
    storage?.removeItem(key)
  } catch {
    // Igual que al guardar.
  }
}
