// Lo común a los dos navegadores de la prueba de humo: lanzarlos, hablarles por WebSocket (CDP o BiDi) y cerrarlos
// sin dejar procesos ni perfiles, aunque algo falle o se quede colgado.
import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"

const COMMAND_MS = 30_000

// Lanza el navegador y espera la dirección del WebSocket que escribe por stderr. wayland: socket de un compositor del
// laboratorio (herramientas/laboratorio/weston.sh) para usar la GPU sin tocar la pantalla del usuario.
export const launch = async (executable, args, profile, addressPattern, wayland = undefined) => {
  const env = { ...process.env }
  delete env.DISPLAY // sin ventana: nunca la pantalla del usuario
  delete env.WAYLAND_DISPLAY
  if (wayland !== undefined) env.WAYLAND_DISPLAY = wayland
  const child = spawn(executable, args, { env, stdio: ["ignore", "ignore", "pipe"] })
  // Si se corta la prueba (Ctrl+C), el navegador y el perfil temporal se van igual.
  const onSignal = () => void stop().finally(() => process.exit(130))
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)
  const stop = async () => {
    process.removeListener("SIGINT", onSignal)
    process.removeListener("SIGTERM", onSignal)
    // Sin pid no llegó a arrancar; con exitCode o signalCode ya terminó.
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve))
      child.kill()
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
      await exited
      clearTimeout(timer)
    }
    await rm(profile, { force: true, maxRetries: 10, recursive: true, retryDelay: 200 })
  }
  try {
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${executable}: sin WebSocket en 30 s`)),
        30_000,
      )
      child.once("exit", () => reject(new Error(`${executable} terminó al arrancar`)))
      child.once("error", reject)
      child.stderr.on("data", (chunk) => {
        const match = addressPattern.exec(String(chunk))
        if (match) {
          clearTimeout(timer)
          resolve(match[1])
        }
      })
    })
    return { address, pid: child.pid, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

// Órdenes por WebSocket con plazo; si la conexión se cae, fallan todas las pendientes.
export const connect = async (address) => {
  const socket = new WebSocket(address)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", () => reject(new Error(`sin conexión con ${address}`)), {
      once: true,
    })
  })
  let lastId = 0
  const pending = new Map()
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data)
    pending.get(message.id)?.(message)
  })
  socket.addEventListener("close", () => {
    for (const settle of pending.values()) settle({ error: { message: "conexión cerrada" } })
  })
  const command = (method, params = {}, sessionId = undefined) =>
    new Promise((resolve, reject) => {
      const id = ++lastId
      const timer = setTimeout(
        () => pending.get(id)?.({ error: { message: `sin respuesta en ${COMMAND_MS} ms` } }),
        COMMAND_MS,
      )
      // CDP da los fallos en «error»; BiDi, con type «error» y «message».
      pending.set(id, (message) => {
        pending.delete(id)
        clearTimeout(timer)
        if (message.error === undefined && message.type !== "error") resolve(message.result)
        else reject(new Error(`${method}: ${message.error?.message ?? message.message}`))
      })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  return { close: () => socket.close(), command }
}
