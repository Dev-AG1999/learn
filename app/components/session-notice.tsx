"use client"

import { useEffect, useRef, useState } from "react"
import {
  ensureSession,
  sessionStatus,
  remaining,
  SessionExpired,
  type BrowserSession,
} from "../../src/auth/browser.ts"
import { RENEW_WINDOW_SECONDS } from "../../src/auth/policy.ts"

type Notice = {
  kind: "ready" | "warning" | "expired" | "network"
  text?: string
}

export function SessionNotice({ userId }: { userId: string }) {
  const sessionRef = useRef<BrowserSession | null>(null)
  const [notice, setNotice] = useState<Notice>({ kind: "ready" })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let stopped = false
    let lastInteraction = performance.now()
    let checking = false
    const forms = new WeakSet<HTMLFormElement>()
    const replaying = new WeakSet<HTMLFormElement>()
    const accepted = (next: BrowserSession) => {
      if (stopped) return false
      if (next.timing.userId !== userId) {
        window.location.replace("/")
        return false
      }
      sessionRef.current = next
      if (!stopped) setNotice({ kind: "ready" })
      return true
    }
    const failed = (error: unknown) => {
      if (!stopped)
        setNotice({
          kind: error instanceof SessionExpired ? "expired" : "network",
          text:
            error instanceof Error
              ? error.message
              : "Session verification failed. Please retry.",
        })
    }
    const renew = async () => {
      if (checking) return
      checking = true
      try {
        accepted(await ensureSession())
      } catch (error) {
        failed(error)
      } finally {
        checking = false
      }
    }
    const tick = () => {
      const session = sessionRef.current
      if (!session || stopped) return
      const idle = remaining(session, "idleExpiresAt"),
        absolute = remaining(session, "absoluteExpiresAt")
      if (Math.min(idle, absolute) <= 0) {
        setNotice({
          kind: "expired",
          text: "Your session has ended. Sign in again in a new tab to keep the details on this page.",
        })
        return
      }
      if (
        document.visibilityState === "visible" &&
        performance.now() - lastInteraction < 60000 &&
        remaining(session, "accessExpiresAt") <= RENEW_WINDOW_SECONDS
      ) {
        void renew()
        return
      }
      if (Math.min(idle, absolute) <= 120)
        setNotice({
          kind: "warning",
          text:
            absolute <= idle
              ? "Your eight-hour session is ending soon. Sign in again to start a new work session."
              : "Your session will end soon due to inactivity. Continue working to stay signed in.",
        })
    }
    const activity = (event: Event) => {
      if (!event.isTrusted) return
      lastInteraction = performance.now()
      tick()
    }
    const submit = (event: SubmitEvent) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement) || !form.closest(".workspace"))
        return
      if (
        (form.getAttribute("method") ?? "").toLowerCase() === "get" ||
        form.getAttribute("action") === "/auth/logout"
      )
        return
      if (replaying.has(form)) {
        replaying.delete(form)
        return
      }
      if (forms.has(form)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      forms.add(form)
      const submitter = event.submitter
      lastInteraction = performance.now()
      void ensureSession()
        .then((next) => {
          forms.delete(form)
          if (!accepted(next)) return
          if (stopped || !form.isConnected) return
          // The replay bypasses this capture handler only once; React/native submit still runs normally.
          replaying.add(form)
          try {
            form.requestSubmit(
              (submitter instanceof HTMLButtonElement ||
                submitter instanceof HTMLInputElement) &&
                submitter.form === form
                ? submitter
                : undefined
            )
          } finally {
            replaying.delete(form)
          }
        })
        .catch((error) => {
          forms.delete(form)
          failed(error)
        })
    }
    const navigate = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null
      if (
        !anchor ||
        anchor.target === "_blank" ||
        !anchor.closest(".workspace")
      )
        return
      const url = new URL(anchor.href, window.location.href)
      if (
        url.origin !== location.origin ||
        !(
          url.pathname === "/" ||
          /^\/hr(?:\/|$)/.test(url.pathname) ||
          /^\/employee\//.test(url.pathname)
        )
      )
        return
      if (
        url.pathname === location.pathname &&
        url.search === location.search &&
        url.hash
      )
        return
      const current = sessionRef.current
      if (
        current &&
        remaining(current, "accessExpiresAt") > RENEW_WINDOW_SECONDS
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      lastInteraction = performance.now()
      void ensureSession()
        .then((next) => {
          if (!stopped && accepted(next)) window.location.assign(url.href)
        })
        .catch(failed)
    }
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("paydesk-session")
        : null
    if (channel)
      channel.onmessage = () => {
        void sessionStatus()
          .then((next) => {
            if (next) accepted(next)
          })
          .catch(() => undefined)
      }
    const visible = () => {
      if (document.visibilityState === "visible") {
        void sessionStatus()
          .then((next) => {
            if (next) accepted(next)
            else if (performance.now() - lastInteraction < 60000) void renew()
          })
          .catch(failed)
      }
    }
    for (const name of ["pointerdown", "keydown", "wheel", "touchstart"])
      window.addEventListener(name, activity, { passive: true })
    document.addEventListener("submit", submit, true)
    document.addEventListener("click", navigate, true)
    document.addEventListener("visibilitychange", visible)
    void sessionStatus()
      .then((next) => {
        if (next) accepted(next)
        else void renew()
      })
      .catch(failed)
    const timer = window.setInterval(tick, 10000)
    return () => {
      stopped = true
      clearInterval(timer)
      channel?.close()
      document.removeEventListener("submit", submit, true)
      document.removeEventListener("click", navigate, true)
      document.removeEventListener("visibilitychange", visible)
      for (const name of ["pointerdown", "keydown", "wheel", "touchstart"])
        window.removeEventListener(name, activity)
    }
  }, [userId])
  if (notice.kind === "ready") return null
  async function resume() {
    setBusy(true)
    try {
      const next = await ensureSession()
      if (next.timing.userId !== userId) {
        window.location.replace("/")
        return
      }
      sessionRef.current = next
      setNotice({ kind: "ready" })
    } catch (error) {
      setNotice({
        kind: error instanceof SessionExpired ? "expired" : "network",
        text: error instanceof Error ? error.message : "Please retry.",
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className={`session-notice notice ${notice.kind === "expired" ? "notice-error" : "notice-info"}`}
      role={notice.kind === "expired" ? "alert" : "status"}
    >
      <div>
        <strong>
          {notice.kind === "expired"
            ? "Sign-in required"
            : notice.kind === "network"
              ? "Check your connection"
              : "Still working?"}
        </strong>
        <p>{notice.text}</p>
        <p className="field-help">
          Your entered details stay on this page. Reloading or closing the page
          will discard unsaved changes.
        </p>
      </div>
      <div className="session-notice-actions">
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={resume}
          disabled={busy}
        >
          {busy
            ? "Checking…"
            : notice.kind === "warning"
              ? "Continue working"
              : "Check session"}
        </button>
        <a
          className="button button-secondary button-small"
          href="/login?reauth=yes"
          target="_blank"
          rel="noopener noreferrer"
        >
          Sign in in a new tab
        </a>
      </div>
    </div>
  )
}
