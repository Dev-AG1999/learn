"use client"
import { apiFetch } from "../client/api.ts"

import { RENEW_WINDOW_SECONDS, type SessionTiming } from "./policy.ts"

export type BrowserSession = { timing: SessionTiming; receivedAt: number }
export class SessionExpired extends Error {}
let renewal: Promise<BrowserSession> | null = null

export function remaining(
  session: BrowserSession,
  field: "accessExpiresAt" | "idleExpiresAt" | "absoluteExpiresAt"
): number {
  return (
    session.timing[field] -
    session.timing.serverNow -
    (performance.now() - session.receivedAt) / 1000
  )
}

function decoded(value: unknown): BrowserSession {
  const timing = (value as { session?: SessionTiming } | null)?.session
  if (
    !timing ||
    typeof timing.userId !== "string" ||
    ![
      timing.accessExpiresAt,
      timing.idleExpiresAt,
      timing.absoluteExpiresAt,
      timing.serverNow,
    ].every(Number.isFinite)
  )
    throw new Error("Session status could not be verified. Please retry.")
  return { timing, receivedAt: performance.now() }
}

let statusRequest: Promise<BrowserSession | null> | null = null
export function sessionStatus(): Promise<BrowserSession | null> {
  if (!statusRequest) statusRequest = loadSessionStatus().finally(() => { statusRequest = null })
  return statusRequest
}

async function loadSessionStatus(): Promise<BrowserSession | null> {
  const response = await apiFetch("/api/auth/session", {
    credentials: "same-origin",
    cache: "no-store",
  })
  if (response.status === 401) return null
  if (!response.ok)
    throw new Error(
      "Session status could not be checked. Your form has been kept on screen."
    )
  return decoded(await response.json())
}

export function ensureSession(): Promise<BrowserSession> {
  if (renewal) return renewal
  renewal = (async () => {
    if (!navigator.locks) {
      const status = await sessionStatus()
      if (status && remaining(status, "accessExpiresAt") > RENEW_WINDOW_SECONDS)
        return status
      throw new Error(
        "Secure session renewal requires a current browser over HTTPS (or localhost). Sign in again in a new tab."
      )
    }
    return navigator.locks.request("paydesk-session-renewal", async () => {
      // Another tab may already have refreshed while this tab waited for the lock.
      const current = await sessionStatus()
      if (
        current &&
        remaining(current, "accessExpiresAt") > RENEW_WINDOW_SECONDS
      )
        return current
      if (current && !current.timing.renewable)
        throw new SessionExpired(
          "Please sign in again to enable session renewal."
        )
      const response = await apiFetch("/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      })
      if (response.status === 401)
        throw new SessionExpired(
          "Your session has ended. Sign in again to continue."
        )
      if (!response.ok)
        throw new Error(
          "Session renewal is temporarily unavailable. Your form has been kept on screen. Please retry."
        )
      const session = decoded(await response.json())
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("paydesk-session")
        channel.postMessage({ type: "renewed" })
        channel.close()
      }
      return session
    })
  })().finally(() => {
    renewal = null
  })
  return renewal
}
