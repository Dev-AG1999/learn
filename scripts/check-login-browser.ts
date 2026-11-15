import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { openTestBrowser } from "./browser-session.ts"

// Native form POSTs apply Referrer-Policy; ordinary HTTP clients do not.
const origin = process.env.APP_ORIGIN ?? "http://localhost:3000"
const url = new URL(origin)
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
  "This diagnostic runs only against a local app."
)
assert.equal(url.origin, origin)
const browser = await openTestBrowser()
try {
  const loginRequests = new Set<string>()
  let formOrigin: string | undefined
  browser.on((message) => {
    const params = message.params as
      | {
          requestId?: string
          request?: { url?: string }
          headers?: Record<string, string>
        }
      | undefined
    if (
      message.method === "Network.requestWillBeSent" &&
      params?.request?.url === `${origin}/auth/login` &&
      params.requestId
    )
      loginRequests.add(params.requestId)
    if (
      message.method === "Network.requestWillBeSentExtraInfo" &&
      params?.requestId &&
      loginRequests.has(params.requestId)
    )
      formOrigin ??= params.headers?.Origin ?? params.headers?.origin
  })
  await browser.navigate(`${origin}/login`)
  await browser.evaluate(
    `document.querySelector('[name="username"]').value=${JSON.stringify(`browser-check-${randomUUID()}`)}; document.querySelector('[name="password"]').value='Synthetic-browser-check-only!'; document.querySelector('form').requestSubmit()`
  )
  await browser.waitFor(
    `location.href === ${JSON.stringify(`${origin}/login?error=invalid`)} && document.body.innerText.includes('Invalid username or password.')`
  )
  assert.equal(
    formOrigin,
    origin,
    "Native form POST lost its Origin. Check Referrer-Policy."
  )
  console.log(
    "Browser regression check passed: native login form preserves Origin and reaches credential validation."
  )
} finally {
  await browser.close()
}
