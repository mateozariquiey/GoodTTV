// Que la pantalla no se apague mientras se ve un directo (la tele usa powerSaveBlocker). El navegador suelta el
// bloqueo al ocultar la pestaña; se vuelve a pedir al volver.
export const createWakeLock = () => {
  let wanted = false
  let sentinel: WakeLockSentinel | undefined
  let pending: Promise<void> | undefined // una sola petición a la vez
  const acquire = (): Promise<void> => {
    if (!wanted || sentinel !== undefined || document.visibilityState !== "visible") {
      return Promise.resolve()
    }
    pending ??= navigator.wakeLock
      .request("screen")
      .then(
        (current) => {
          // Si mientras tanto se dejó de ver el directo, se suelta enseguida.
          if (!wanted) {
            void current.release()
            return
          }
          current.addEventListener("release", () => {
            if (sentinel === current) sentinel = undefined
          })
          sentinel = current
        },
        () => undefined, // sin permiso o sin soporte: la pantalla se apagará como siempre
      )
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  document.addEventListener("visibilitychange", () => void acquire())
  return {
    setWatching: async (active: boolean): Promise<void> => {
      wanted = active
      if (active) await acquire()
      else {
        const current = sentinel
        sentinel = undefined
        await current?.release()
      }
    },
  }
}
