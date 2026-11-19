import { spawn } from "node:child_process"
import type { Readable } from "node:stream"

// Real X key events are the closest thing to a USB remote: they go through X11 and Chromium,
// then main's before-input-event, exactly like the hardware. The suite owns a private Xvfb
// display so it never types into the developer's session. Override the binaries with
// E2E_XVFB / E2E_XDOTOOL (and E2E_LD_LIBRARY_PATH) when they are not on PATH.
// Without Xvfb and xdotool, E2E_WAYLAND=<socket> runs the suite in a headless Wayland compositor
// that is already running (Weston, see app.ts).
// Without E2E_DISPLAY, Xvfb picks the first free display itself, so two runs on the same machine
// never share one. With E2E_DISPLAY, a display that is already in use is an error.
const DISPLAY = process.env["E2E_DISPLAY"]

// The critical path needs channels that are live right now. Without E2E_CHANNELS it takes the most watched ones
// from Twitch's public GraphQL (as a guest), so the suite does not depend on a fixed list being on air.
const pickLiveChannels = async (): Promise<void> => {
  if (process.env["E2E_CHANNELS"] !== undefined) return
  try {
    const response = await fetch("https://gql.twitch.tv/gql", {
      body: JSON.stringify({
        query: "query { streams(first: 12) { edges { node { type broadcaster { login } } } } }",
      }),
      headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Content-Type": "text/plain" },
      method: "POST",
    })
    const body = (await response.json()) as {
      data: {
        streams: { edges: { node: { type: string; broadcaster: { login: string } | null } }[] }
      }
    }
    const logins = body.data.streams.edges
      .filter(({ node }) => node.type === "live" && node.broadcaster !== null)
      .map(({ node }) => node.broadcaster?.login)
      .slice(0, 6)
    if (logins.length > 0) process.env["E2E_CHANNELS"] = logins.join(",")
  } catch {
    // Without network the critical path fails on its own; the other specs do not need channels.
  }
}

export default async function startDisplay(): Promise<() => Promise<void>> {
  await pickLiveChannels()
  if (process.env["E2E_HEADED"] !== undefined || process.env["E2E_WAYLAND"] !== undefined)
    return async () => {}
  const xvfb = process.env["E2E_XVFB"] ?? "Xvfb"
  // -displayfd 3: Xvfb writes its display number to fd 3 once it accepts connections. Waiting
  // for that, not for the socket, means another server's socket can never pass for ours.
  const server = spawn(
    xvfb,
    [
      ...(DISPLAY === undefined ? [] : [DISPLAY]),
      "-displayfd",
      "3",
      "-screen",
      "0",
      "1920x1080x24",
      "-nolisten",
      "tcp",
    ],
    {
      env: { ...process.env, LD_LIBRARY_PATH: process.env["E2E_LD_LIBRARY_PATH"] ?? "" },
      stdio: ["ignore", "ignore", "pipe", "pipe"],
    },
  )
  const display = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.kill("SIGTERM")
      reject(new Error(`${xvfb} did not open ${DISPLAY ?? "a display"} within 5 s`))
    }, 5_000)
    let number = ""
    let errors = ""
    server.stderr?.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-2_000)
    })
    ;(server.stdio[3] as Readable).on("data", (chunk: Buffer) => {
      number += chunk.toString()
      if (!number.endsWith("\n")) return
      clearTimeout(timeout)
      resolve(`:${number.trim()}`)
    })
    server.once("error", (error) => {
      clearTimeout(timeout)
      reject(new Error(`Could not start ${xvfb}: ${error.message}`))
    })
    // Xvfb exits at once when the display is taken ("server already running").
    server.once("exit", (code, signal) => {
      clearTimeout(timeout)
      const reason = errors
        .match(/Fatal server error:\s*([^\n]*)/)?.[1]
        ?.replace(/\(EE\)/g, "")
        .trim()
      reject(
        new Error(
          `${xvfb} exited (${signal ?? `code ${code}`}) before opening ${DISPLAY ?? "a display"}` +
            (reason ? `: ${reason}` : "") +
            (DISPLAY === undefined
              ? ""
              : `. Is another X server or e2e run using ${DISPLAY}? Unset E2E_DISPLAY to use a free display.`),
        ),
      )
    })
  })
  process.env["DISPLAY"] = display
  return async () => {
    server.kill("SIGTERM")
  }
}
