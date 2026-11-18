import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import {
  ConnectDrive,
  googleAuthorizationUrl,
} from "../app/components/connect-drive.tsx"

test("Google navigation accepts only the intended HTTPS authorization endpoint", () => {
  expect(
    googleAuthorizationUrl(
      "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic"
    )
  ).toContain("accounts.google.com")
  for (const value of [
    null,
    "javascript:alert(1)",
    "https://evil.test/auth",
    "https://accounts.google.com.evil.test/o/oauth2/v2/auth",
    "https://accounts.google.com/other",
    "https://user@accounts.google.com/o/oauth2/v2/auth",
  ])
    expect(() => googleAuthorizationUrl(value)).toThrow()
})
test("connect control uses normal navigation rather than a native external-redirect form", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectDrive, {
      configured: true,
      connected: false,
      userId: "hr-user",
    })
  )
  expect(html).toContain('type="button"')
  expect(html).toContain("Google authorization opens in this tab")
  expect(html).not.toContain("<form")
})
