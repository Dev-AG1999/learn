"use client"
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import type { EmployeeDirectoryPage } from "../../../src/db/sqlite-payroll.ts"
import { apiFetch, JsonReadCache, canonicalQuery, debounce, throttle } from "../../../src/client/api.ts"
import { ensureSession } from "../../../src/auth/browser.ts"
import { formatMoney, monthNames, periodLabel, periodQuery } from "../../../src/presentation.ts"
import { EmptyState } from "../../components/workspace.tsx"
import { Icon } from "../../components/ui-icon.tsx"
type Query = {
  q?: string
  currency?: string
  cursor?: string
  year?: string
  month?: string
}
export function EmployeeDirectory({
  initialPage, initialQuery, initialPeriod, valid, userId, currencies,
}: {
  initialPage: EmployeeDirectoryPage
  initialQuery: Query
  initialPeriod: { year: number; month: number }
  valid: boolean
  userId: string
  currencies: string[]
}) {
  const [page, setPage] = useState(initialPage)
  const [query, setQuery] = useState(initialQuery)
  const [period, setPeriod] = useState(initialPeriod)
  const [busy, setBusy] = useState(false)
  const [isValid, setValid] = useState(valid)
  const [error, setError] = useState("")
  const cache = useMemo(() => {
    const reads = new JsonReadCache()
    const initialFilters = new URLSearchParams({
      year: String(initialPeriod.year), month: String(initialPeriod.month),
      q: (initialQuery.q ?? "").trim(), currency: initialQuery.currency ?? "",
    })
    if (initialQuery.cursor) initialFilters.set("cursor", initialQuery.cursor)
    if (valid) reads.seed(canonicalQuery(initialFilters), initialPage)
    return reads
  }, [userId, initialPage, initialQuery, initialPeriod, valid])
  const sequence = useRef(0)
  const controllers = useRef(new Set<AbortController>())
  const formRef = useRef<HTMLFormElement>(null)
  const active = useRef(true)
  const prefix = (query.q ?? "").trim(), currency = query.currency ?? ""
  const filters = new URLSearchParams({ year: String(period.year), month: String(period.month), q: prefix, currency })
  const first = `/hr/employees?${filters}`
  const next = new URLSearchParams(filters)
  if (page.nextCursor) next.set("cursor", page.nextCursor)
  async function search(params: URLSearchParams) {
    if (document.visibilityState === "hidden") return
    const ticket = ++sequence.current
    setBusy(true)
    setError("")
    try {
      const session = await ensureSession()
      if (session.timing.userId !== userId) {
        cache.clear()
        throw new Error("Your account changed. Reload before searching.")
      }
      if (!active.current || ticket !== sequence.current) return
      const key = canonicalQuery(params)
      const result = await cache.read<EmployeeDirectoryPage>(key, async () => {
        const abort = new AbortController()
        controllers.current.add(abort)
        try {
          const response = await apiFetch(`/api/employees?${key}`, { cache: "no-store", credentials: "same-origin", signal: abort.signal })
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) cache.clear()
          throw new Error(response.status === 401 || response.status === 403 ? "Sign in again before searching." : "Search failed. Please retry.")
        }
        return await response.json() as EmployeeDirectoryPage
        } finally {
          controllers.current.delete(abort)
        }
      })
      if (!active.current || ticket !== sequence.current) return
      setValid(true)
      setPage(result)
      setQuery(Object.fromEntries(params))
      setPeriod({ year: Number(params.get("year")), month: Number(params.get("month")) })
      history.replaceState(null, "", `/hr/employees?${key}`)
    } catch (error) {
      if (active.current && ticket === sequence.current && !(error instanceof DOMException && error.name === "AbortError"))
        setError(error instanceof Error ? error.message : "Please retry.")
    } finally {
      if (active.current && ticket === sequence.current) setBusy(false)
    }
  }
  const latestSearch = useRef(search)
  latestSearch.current = search
  const apply = useMemo(() => () => {
    const form = formRef.current
    if (form?.reportValidity()) void latestSearch.current(new URLSearchParams(Array.from(new FormData(form), ([key, value]) => [key, String(value)])))
  }, [])
  const delayed = useMemo(() => debounce(apply), [apply])
  const clicked = useMemo(() => throttle(apply), [apply])
  function changed() {
    sequence.current++
    delayed()
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    delayed.cancel()
    clicked()
  }
  useEffect(() => {
    active.current = true
    const clear = () => {
      sequence.current++
      controllers.current.forEach((controller) => controller.abort())
      cache.clear()
      setBusy(false)
    }
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        delayed.cancel()
        clear()
      }
    }
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("paydesk-session") : null
    if (channel) channel.onmessage = (event: MessageEvent<unknown>) => {
      // Renewal does not change identity; do not cancel the search that renewed it.
      if ((event.data as { type?: string } | null)?.type === "renewed") cache.clear()
      else clear()
    }
    document.addEventListener("visibilitychange", visibility)
    return () => {
      active.current = false
      sequence.current++
      delayed.cancel()
      controllers.current.forEach((controller) => controller.abort())
      cache.clear()
      channel?.close()
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [cache, delayed])
  return (<>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Find an employee</h2>
            <p>
              Search by the start of an employee ID. IDs are case-sensitive.
            </p>
          </div>
          <Icon name="search" />
        </div>
        <form
          ref={formRef}
          onSubmit={submit}
          onChange={changed}
          method="get"
          action="/hr/employees"
          className="panel-body employee-directory-filters"
        >
          <label>
            Employee ID starts with
            <input
              name="q"
              defaultValue={initialQuery.q ?? ""}
              maxLength={64}
              pattern="[A-Za-z0-9_-]*"
              placeholder="e.g. EMP- or HR-DEMO-"
            />
          </label>
          <label>
            CTC currency
            <select name="currency" defaultValue={currency}>
              <option value="">All currencies</option>
              {currencies.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
          </label>
          <label>
            Payroll month
            <select name="month" defaultValue={period.month}>
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
              name="year"
              type="number"
              min="1900"
              max="9999"
              defaultValue={period.year}
              required
            />
          </label>
          <button className="button button-primary">Apply filters</button>
          <button className="button button-secondary" type="button" onClick={() => { cache.clear(); delayed.cancel(); apply() }}>Refresh results</button>
        </form>
      </section>
      {error && <p role="alert" className="notice notice-error">{error}</p>}
      {busy && <p role="status" className="field-help">Searching employees…</p>}
      {!isValid && (
        <div role="alert" className="notice notice-error">
          Choose a valid period and currency. Search IDs using letters, numbers,
          hyphens or underscores.
        </div>
      )}
      <section className="panel" aria-busy={busy}>
        <div className="panel-heading">
          <div>
            <h2>Employee salary records</h2>
            <p>
              {periodLabel(period)} monthly pay · Annual CTC is the employee's
              current saved input.
            </p>
          </div>
          <span className="badge badge-neutral">
            {page.employees.length} shown
          </span>
        </div>
        {page.employees.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">
                Employee directory and saved pay for {periodLabel(period)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Employee ID</th>
                  <th scope="col">Current annual CTC</th>
                  <th scope="col">Monthly net pay</th>
                  <th scope="col">Payslip</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {page.employees.map((employee) => (
                  <tr key={employee.employeeId}>
                    <td>
                      <strong>{employee.employeeId}</strong>
                    </td>
                    <td className="amount">
                      {employee.currency}{" "}
                      {formatMoney(employee.annualCtcMinor, employee.currency)}
                    </td>
                    <td className="amount">
                      {employee.monthlyNetMinor !== null &&
                      employee.monthlyCurrency
                        ? `${employee.monthlyCurrency} ${formatMoney(employee.monthlyNetMinor, employee.monthlyCurrency)}`
                        : "—"}
                    </td>
                    <td>
                      <span
                        className={`badge ${employee.monthlyNetMinor !== null ? "badge-green" : "badge-neutral"}`}
                      >
                        {employee.monthlyNetMinor !== null
                          ? "Available"
                          : "Not saved this month"}
                      </span>
                    </td>
                    <td>
                      <a
                        className="text-link"
                        href={`/hr/salary?employeeId=${encodeURIComponent(employee.employeeId)}&${periodQuery(period)}`}
                        aria-label={`Edit salary for ${employee.employeeId}`}
                      >
                        Edit salary <Icon name="arrow" size={15} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="users"
            title={
              prefix || currency || query.cursor
                ? "No matching employees"
                : "No employees yet"
            }
            description={
              prefix || currency || query.cursor
                ? "Try a different ID prefix, currency, or return to the first page."
                : "Add an employee manually or upload a salary sheet. Saved employee records will appear here."
            }
          >
            <a
              className="text-link"
              href={
                prefix || currency || query.cursor
                  ? `/hr/employees?${periodQuery(period)}`
                  : "/hr/import"
              }
            >
              {prefix || currency || query.cursor
                ? "Clear filters"
                : "Upload salary sheet"}{" "}
              <Icon name="arrow" size={16} />
            </a>
          </EmptyState>
        )}
        <div className="review-pagination">
          <span>
            Up to 25 employees per page. Employees stay listed even when this
            month has no payslip.
          </span>
          <div>
            {query.cursor && (
              <a className="button button-secondary button-small" href={first} onClick={(event) => { event.preventDefault(); void search(new URL(first, location.origin).searchParams) }}>
                First page
              </a>
            )}
            {page.nextCursor && (
              <a
                className="button button-secondary button-small"
                href={`/hr/employees?${next}`}
                onClick={(event) => { event.preventDefault(); void search(next) }}
              >
                Next employees →
              </a>
            )}
          </div>
        </div>
      </section>
    </>)
}
