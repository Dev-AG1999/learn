"use client"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { apiFetch } from "../../src/client/api.ts"
import { ensureSession } from "../../src/auth/browser.ts"
import { compressFormFiles } from "../../src/files/browser.ts"
import { monthNames } from "../../src/presentation.ts"
import { Icon } from "./ui-icon.tsx"
import type { ChatAnswer } from "../../src/ai/chat.ts"
import type { UploadReview } from "../../src/ai/review.ts"
type Message = {
  role: "user" | "assistant"
  content: string
  sources?: ChatAnswer["sources"]
}
type Attachment = { id: string; name: string }
export function Chatbot({
  userId,
  role,
  employeeId,
  period,
  enabled,
}: {
  userId: string
  role: "hr" | "employee"
  employeeId: string | null
  period: { year: number; month: number }
  enabled: boolean
}) {
  const [open, setOpen] = useState(false),
    [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("")
  const [selectedEmployee, setEmployee] = useState(employeeId ?? ""),
    [month, setMonth] = useState(period.month),
    [year, setYear] = useState(String(period.year))
  const [attachments, setAttachments] = useState<Attachment[]>([]),
    [recent, setRecent] = useState<Attachment[]>([])
  const [review, setReview] = useState<UploadReview | null>(null)
  const pending = useRef(false),
    loaded = useRef(false),
    fileInput = useRef<HTMLInputElement>(null)
  const questionInput = useRef<HTMLTextAreaElement>(null),
    toggle = useRef<HTMLButtonElement>(null),
    log = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (new URLSearchParams(location.search).get("chat") === "open")
      setOpen(true)
  }, [])
  useEffect(() => {
    if (!open) return
    questionInput.current?.focus()
    if (!enabled || loaded.current) return
    loaded.current = true
    const controller = new AbortController()
    void apiFetch("/api/chat/attachments", { signal: controller.signal })
      .then(async (response) => {
        if (response.ok)
          setRecent((await response.json()).files as Attachment[])
      })
      .catch(() => {
        loaded.current = false
      })
    return () => controller.abort()
  }, [open, enabled])
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" })
  }, [messages, busy])
  function close() {
    setOpen(false)
    toggle.current?.focus()
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current || !question.trim()) return
    pending.current = true
    setBusy("Checking session…")
    setError("")
    const text = question.trim()
    let selected = attachments
    try {
      if (
        !Number.isInteger(Number(year)) ||
        Number(year) < 1900 ||
        Number(year) > 9999
      )
        throw new Error("Choose a valid payroll year.")
      if (selectedEmployee && !/^[A-Za-z0-9_-]{1,64}$/.test(selectedEmployee))
        throw new Error("Choose a valid employee ID.")
      const session = await ensureSession()
      if (session.timing.userId !== userId)
        throw new Error("Your account changed. Reload before using chat.")
      const file = fileInput.current?.files?.[0]
      if (file) {
        if (selected.length >= 2)
          throw new Error(
            "Remove an attachment before adding another. Two documents can be attached per conversation."
          )
        if (
          file.size > (/\.pdf$/i.test(file.name) ? 5 : 8) * 1024 * 1024 ||
          !/\.(pdf|png|jpe?g)$/i.test(file.name)
        )
          throw new Error(
            "Choose a PDF, PNG or JPEG up to 8 MiB. PDFs for chat support up to 5 MiB."
          )
        setBusy("Compressing attachment…")
        const form = new FormData()
        form.set("attachment", file)
        await compressFormFiles(form, ["attachment"])
        setBusy("Scanning attachment and reviewing its fields…")
        const upload = await apiFetch("/api/chat/attachments", {
          method: "POST",
          body: form,
        })
        const result = await upload.json()
        if (!upload.ok)
          throw new Error(result.error ?? "Attachment could not be uploaded.")
        selected = [...selected, result.file as Attachment]
        setAttachments(selected)
        setReview(result.review as UploadReview)
        if (fileInput.current) fileInput.current.value = ""
      }
      setBusy("Reading authorized records and preparing an answer…")
      const response = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          employeeId: selectedEmployee || undefined,
          year: Number(year),
          month: Number(month),
          attachments: selected.map((file) => file.id),
          history: messages
            .slice(-6)
            .map(({ role, content }) => ({ role, content })),
        }),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error ?? "Chat is unavailable. Please retry.")
      setMessages((current) => [
        ...current.slice(-18),
        { role: "user", content: text },
        { role: "assistant", content: result.answer, sources: result.sources },
      ])
      setQuestion("")
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please retry.")
    } finally {
      pending.current = false
      setBusy("")
    }
  }
  return (
    <>
      <button
        ref={toggle}
        type="button"
        className="chat-toggle"
        aria-expanded={open}
        aria-controls="workspace-chat"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="spark" size={20} />
        Ask Paydesk
      </button>
      {open && (
        <section
          id="workspace-chat"
          className="chat-panel"
          role="dialog"
          aria-labelledby="chat-title"
          onKeyDown={(event) => {
            if (event.key === "Escape") close()
          }}
        >
          <header className="chat-header">
            <div>
              <h2 id="chat-title">Paydesk chat</h2>
              <p>Payroll, documents and general explanations</p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close chat"
              onClick={close}
            >
              ×
            </button>
          </header>
          {!enabled ? (
            <div className="chat-settings">
              <p>
                Your administrator needs to complete local AI setup before chat
                is available.
              </p>
            </div>
          ) : (
            <>
              <details className="chat-context">
                <summary>
                  Payroll context · {monthNames[month - 1]} {year}
                  {selectedEmployee ? ` · ${selectedEmployee}` : ""}
                </summary>
                <div className="chat-context-fields">
                  {role === "hr" && (
                    <label>
                      Employee ID (for salary questions)
                      <input
                        value={selectedEmployee}
                        onChange={(event) => setEmployee(event.target.value)}
                        maxLength={64}
                        placeholder="Choose an employee ID"
                        disabled={!!busy}
                      />
                    </label>
                  )}
                  <label>
                    Month
                    <select
                      value={month}
                      onChange={(event) => setMonth(Number(event.target.value))}
                      disabled={!!busy}
                    >
                      {monthNames.map((name, index) => (
                        <option key={name} value={index + 1}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Year
                    <input
                      type="number"
                      min="1900"
                      max="9999"
                      value={year}
                      onChange={(event) => setYear(event.target.value)}
                      disabled={!!busy}
                    />
                  </label>
                </div>
              </details>
              <div className="chat-log" ref={log} role="log" aria-live="polite">
                {!messages.length && (
                  <div className="chat-welcome">
                    <strong>How can I help?</strong>
                    <p>
                      Ask why your saved salary changed, explain an uploaded
                      receipt, discuss a published policy, or try “calculate 20%
                      of 5000”.
                    </p>
                    <small>
                      Missing deduction reasons stay unknown. Uploading here
                      does not submit a claim or update payroll.
                    </small>
                  </div>
                )}
                {messages.map((message, index) => (
                  <article
                    key={index}
                    className={`chat-message chat-message-${message.role}`}
                  >
                    <strong>
                      {message.role === "user" ? "You" : "Paydesk"}
                    </strong>
                    <p>{message.content}</p>
                    {message.sources?.map((source, number) => (
                      <details key={number}>
                        <summary>{source.label}</summary>
                        <blockquote>{source.text}</blockquote>
                      </details>
                    ))}
                  </article>
                ))}
              </div>
              <div className="chat-composer">
                {attachments.length > 0 && (
                  <div className="chat-attachments">
                    {attachments.map((file) => (
                      <span key={file.id}>
                        {file.name}
                        <button
                          aria-label={`Remove ${file.name}`}
                          type="button"
                          disabled={!!busy}
                          onClick={() =>
                            setAttachments((current) =>
                              current.filter((item) => item.id !== file.id)
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {review && (
                  <details className="field-help">
                    <summary>
                      Attachment AI review ·{" "}
                      {review.status.replaceAll("-", " ")}
                    </summary>
                    <p>{review.summary}</p>
                  </details>
                )}
                <details>
                  <summary className="field-help">
                    Attach a saved document
                  </summary>
                  <select
                    aria-label="Saved chat attachment"
                    disabled={!!busy || attachments.length >= 2}
                    value=""
                    onChange={(event) => {
                      const file = recent.find(
                        (entry) => entry.id === event.target.value
                      )
                      if (
                        file &&
                        !attachments.some((entry) => entry.id === file.id)
                      )
                        setAttachments((current) =>
                          [...current, file].slice(0, 2)
                        )
                    }}
                  >
                    <option value="">Select a scan-passed document</option>
                    {recent.map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.name}
                      </option>
                    ))}
                  </select>
                </details>
                <form
                  method="post"
                  onSubmit={submit}
                  data-session-managed="true"
                >
                  <fieldset disabled={!!busy} className="attachment-fields">
                    <label className="sr-only" htmlFor="chat-question">
                      Your message
                    </label>
                    <textarea
                      id="chat-question"
                      ref={questionInput}
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      maxLength={2000}
                      rows={3}
                      placeholder="Ask a question…"
                      required
                    />
                    <label className="field-help">
                      Attach PDF or image
                      <input
                        ref={fileInput}
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        aria-label="Chat file attachment"
                      />
                    </label>
                    <button className="button button-primary" type="submit">
                      {busy ? "Working…" : "Send message"}
                    </button>
                  </fieldset>
                </form>
                {busy && (
                  <p role="status" className="field-help">
                    {busy}
                  </p>
                )}
                {error && (
                  <p role="alert" className="chat-error">
                    {error}
                  </p>
                )}
                <p className="field-help">
                  Check cited sources before acting. New calculations use code;
                  AI explanations may need review.
                </p>
              </div>
            </>
          )}
        </section>
      )}
    </>
  )
}
