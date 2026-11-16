"use client"

import { useEffect, useState } from "react"
import { ensureSession } from "../../../src/auth/browser.ts"

export function RenewSession({ returnTo }: { returnTo: string }) {
  const [error, setError] = useState("")
  useEffect(() => {
    let active = true
    void ensureSession()
      .then(() => {
        if (active) window.location.replace(returnTo)
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "Please sign in again."
          )
      })
    return () => {
      active = false
    }
  }, [returnTo])
  return (
    <main className="error-page">
      <section className="error-card">
        <p className="eyebrow">SECURE WORKSPACE</p>
        <h1>{error ? "Please sign in again" : "Restoring your session"}</h1>
        <p role="status">
          {error ||
            "Checking your session so you can continue where you left off…"}
        </p>
        {error && (
          <>
            <a className="button button-primary" href="/login">
              Sign in
            </a>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </>
        )}
      </section>
    </main>
  )
}
