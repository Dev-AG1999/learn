import { spawn } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

type ProtocolMessage = {
  id?: number
  result?: unknown
  error?: { message: string }
  method?: string
  params?: unknown
}

// A small Chrome DevTools harness for local, isolated UI checks. No user profile is reused.
export async function openTestBrowser(ignoreCertificateErrors = false) {
  const executable =
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if (!existsSync(executable))
    throw new Error("Set CHROME_PATH to a local Chrome executable.")
  const profile = mkdtempSync(join(tmpdir(), "paydesk-browser-"))
  const chrome = spawn(
    executable,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      ...(ignoreCertificateErrors ? ["--ignore-certificate-errors"] : []),
      "about:blank",
    ],
    { stdio: "ignore" }
  )
  let socket: WebSocket | undefined
  let launchError: Error | undefined
  chrome.on("error", (error) => {
    launchError = error
  })
  const close = async () => {
    socket?.close()
    if (chrome.exitCode === null && !launchError) {
      chrome.kill("SIGTERM")
      await new Promise<void>((resolve) => chrome.once("exit", () => resolve()))
    }
    rmSync(profile, { recursive: true, force: true })
  }
  try {
    const portFile = join(profile, "DevToolsActivePort")
    for (let i = 0; i < 100 && !existsSync(portFile); i++) {
      if (launchError) throw launchError
      if (chrome.exitCode !== null)
        throw new Error("Chrome exited before starting its test interface.")
      await delay(100)
    }
    if (!existsSync(portFile)) throw new Error("Headless Chrome did not start.")
    const port = Number(readFileSync(portFile, "utf8").split("\n")[0])
    if (!Number.isInteger(port) || port <= 0 || port > 65535)
      throw new Error("Invalid browser test port.")
    const target = (await (
      await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
        method: "PUT",
      })
    ).json()) as { webSocketDebuggerUrl: string }
    const connection = new WebSocket(target.webSocketDebuggerUrl)
    socket = connection
    await new Promise<void>((resolve, reject) => {
      connection.addEventListener("open", () => resolve(), { once: true })
      connection.addEventListener(
        "error",
        () => reject(new Error("Cannot connect to test browser.")),
        { once: true }
      )
    })
    let sequence = 0
    const pending = new Map<
      number,
      { resolve: (result: unknown) => void; reject: (error: Error) => void }
    >()
    const listeners = new Set<(message: ProtocolMessage) => void>()
    connection.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as ProtocolMessage
      if (message.id) {
        const entry = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) entry?.reject(new Error(message.error.message))
        else entry?.resolve(message.result)
      } else for (const listener of listeners) listener(message)
    })
    const send = <T = unknown>(
      method: string,
      params: Record<string, unknown> = {}
    ) =>
      new Promise<T>((resolve, reject) => {
        const id = ++sequence
        pending.set(id, { resolve: (result) => resolve(result as T), reject })
        connection.send(JSON.stringify({ id, method, params }))
      })
    const evaluate = async <T = unknown>(expression: string): Promise<T> => {
      const result = await send<{
        result: { value?: T }
        exceptionDetails?: unknown
      }>("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (result.exceptionDetails)
        throw new Error("Browser test expression failed.")
      return result.result.value as T
    }
    const waitFor = async (expression: string) => {
      for (let i = 0; i < 150; i++) {
        try {
          if (await evaluate<boolean>(expression)) return
        } catch {
          /* Navigation replaces the execution context. */
        }
        await delay(100)
      }
      throw new Error(`Browser condition timed out: ${expression}`)
    }
    await send("Page.enable")
    await send("Network.enable")
    await send("Runtime.enable")
    return {
      send,
      evaluate,
      waitFor,
      close,
      on: (listener: (message: ProtocolMessage) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      navigate: async (url: string) => {
        await send("Page.navigate", { url })
        await waitFor(
          `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`
        )
      },
      viewport: async (width: number, height = 1000) => {
        await send("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: width < 700,
        })
      },
      screenshot: async (path: string) => {
        const result = await send<{ data: string }>("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        })
        writeFileSync(path, Buffer.from(result.data, "base64"))
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
