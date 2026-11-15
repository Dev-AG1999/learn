import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

// Exercise an actual native form POST. HTTP clients do not apply Referrer-Policy.
// Only a nonexistent synthetic account is submitted; no session is created.
const origin = process.env.APP_ORIGIN ?? "http://localhost:3000"
const url = new URL(origin)
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "This diagnostic runs only against a local app.")
assert.equal(url.origin, origin, "APP_ORIGIN must be an exact origin.")
const executable = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
assert.ok(existsSync(executable), "Set CHROME_PATH to a local Chrome executable.")
const profile = mkdtempSync(join(tmpdir(), "payroll-browser-test-"))
const chrome = spawn(executable, [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" })
let socket: WebSocket | undefined
let launchError: Error | undefined
chrome.on("error", error => { launchError = error })

type ProtocolResult = { result?: { value?: unknown } }
type ProtocolMessage = {
  id?: number
  error?: { message: string }
  result?: ProtocolResult
  method?: string
  params?: { requestId?: string; request?: { url?: string }; headers?: Record<string, string> }
}

try {
  const portFile = join(profile, "DevToolsActivePort")
  for (let i = 0; i < 100 && !existsSync(portFile); i++) {
    if (launchError) throw launchError
    if (chrome.exitCode !== null) throw new Error("Chrome exited before starting its test interface.")
    await delay(100)
  }
  assert.ok(existsSync(portFile), "Headless Chrome did not start.")
  const port = Number(readFileSync(portFile, "utf8").split("\n")[0])
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535)
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json() as { webSocketDebuggerUrl: string }
  const connection = new WebSocket(target.webSocketDebuggerUrl)
  socket = connection
  await new Promise<void>((resolve, reject) => {
    connection.addEventListener("open", () => resolve(), { once: true })
    connection.addEventListener("error", () => reject(new Error("Cannot connect to headless Chrome.")), { once: true })
  })
  let sequence = 0
  const pending = new Map<number, { resolve: (result: ProtocolResult) => void; reject: (error: Error) => void }>()
  const listeners = new Set<(message: ProtocolMessage) => void>()
  connection.addEventListener("message", event => {
    const message = JSON.parse(String(event.data)) as ProtocolMessage
    if (message.id) {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) entry?.reject(new Error(message.error.message))
      else entry?.resolve(message.result ?? {})
    } else for (const listener of [...listeners]) listener(message)
  })
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<ProtocolResult>((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    connection.send(JSON.stringify({ id, method, params }))
  })
  const loaded = () => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { listeners.delete(listener); reject(new Error("Timed out waiting for the local page. Start npm run dev first.")) }, 15000)
    const listener = (message: ProtocolMessage) => {
      if (message.method === "Page.loadEventFired") {
        clearTimeout(timer)
        listeners.delete(listener)
        resolve()
      }
    }
    listeners.add(listener)
  })
  const loginRequests = new Set<string>()
  let formOrigin: string | undefined
  listeners.add(message => {
    const params = message.params
    if (message.method === "Network.requestWillBeSent" && params?.request?.url === `${origin}/auth/login` && params.requestId) loginRequests.add(params.requestId)
    if (message.method === "Network.requestWillBeSentExtraInfo" && params?.requestId && loginRequests.has(params.requestId)) {
      formOrigin ??= params.headers?.Origin ?? params.headers?.origin
    }
  })
  await send("Page.enable")
  await send("Network.enable")
  await send("Runtime.enable")
  let navigation = loaded()
  await send("Page.navigate", { url: `${origin}/login` })
  await navigation
  const username = `browser-check-${randomUUID()}`
  navigation = loaded()
  await send("Runtime.evaluate", {
    expression: `document.querySelector('[name="username"]').value=${JSON.stringify(username)}; document.querySelector('[name="password"]').value='Synthetic-browser-check-only!'; document.querySelector('form').requestSubmit();`,
  })
  await navigation
  const result = await send("Runtime.evaluate", {
    expression: 'JSON.stringify({url:location.href,invalidCredentials:document.body.innerText.includes("Invalid username or password.")})', returnByValue: true,
  })
  const page = JSON.parse(String(result.result?.value)) as { url: string; invalidCredentials: boolean }
  assert.equal(formOrigin, origin, "Native form POST lost its Origin. Check the login page Referrer-Policy.")
  assert.equal(page.url, `${origin}/login?error=invalid`, "The form was blocked before credential validation.")
  assert.equal(page.invalidCredentials, true)
  console.log("Browser regression check passed: native login form preserves Origin and reaches credential validation.")
} finally {
  socket?.close()
  if (chrome.exitCode === null && !launchError) {
    chrome.kill("SIGTERM")
    await new Promise<void>(resolve => chrome.once("exit", () => resolve()))
  }
  rmSync(profile, { recursive: true, force: true })
}
