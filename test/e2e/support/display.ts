import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

// Real X key events are the closest thing to a USB remote: they go through X11 and Chromium,
// then main's before-input-event, exactly like the hardware. The suite owns a private Xvfb
// display so it never types into the developer's session. Override the binaries with
// E2E_XVFB / E2E_XDOTOOL (and E2E_LD_LIBRARY_PATH) when they are not on PATH.
const DISPLAY = process.env["E2E_DISPLAY"] ?? ":96"

export default async function startDisplay(): Promise<() => Promise<void>> {
  if (process.env["E2E_HEADED"] !== undefined) return async () => {}
  const xvfb = process.env["E2E_XVFB"] ?? "Xvfb"
  const server = spawn(xvfb, [DISPLAY, "-screen", "0", "1920x1080x24", "-nolisten", "tcp"], {
    env: { ...process.env, LD_LIBRARY_PATH: process.env["E2E_LD_LIBRARY_PATH"] ?? "" },
    stdio: "ignore",
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error) => reject(new Error(`Could not start ${xvfb}: ${error.message}`)))
    const socket = `/tmp/.X11-unix/X${DISPLAY.slice(1)}`
    const started = Date.now()
    const poll = setInterval(() => {
      if (existsSync(socket)) {
        clearInterval(poll)
        resolve()
      } else if (Date.now() - started > 5_000) {
        clearInterval(poll)
        reject(new Error(`Xvfb did not open ${DISPLAY}`))
      }
    }, 50)
  })
  process.env["DISPLAY"] = DISPLAY
  return async () => {
    server.kill("SIGTERM")
  }
}
