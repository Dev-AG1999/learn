"use client"

// Memory only: no payroll data or credentials are written to browser storage.
export class JsonReadCache {
  private values = new Map<string, { json: string; until: number }>()
  private pending = new Map<string, Promise<string>>()
  private generation = 0
  readonly diagnostics = { network: 0, hits: 0, shared: 0, failures: 0 }
  constructor(private readonly ttl = 15000, private readonly capacity = 50) {}
  seed<T>(key: string, value: T) {
    this.values.set(key, { json: JSON.stringify(value), until: Date.now() + this.ttl })
  }
  clear() {
    this.generation++
    this.values.clear()
    this.pending.clear()
  }
  async read<T>(url: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(url)
    if (cached && cached.until > Date.now()) {
      this.diagnostics.hits++
      this.values.delete(url)
      this.values.set(url, cached)
      return JSON.parse(cached.json) as T
    }
    this.values.delete(url)
    let request = this.pending.get(url)
    if (request) this.diagnostics.shared++
    else {
      const generation = this.generation
      this.diagnostics.network++
      request = Promise.resolve().then(load).then((value) => {
        const json = JSON.stringify(value)
        if (generation === this.generation) {
          this.values.set(url, { json, until: Date.now() + this.ttl })
          while (this.values.size > this.capacity)
            this.values.delete(this.values.keys().next().value!)
        }
        return json
      }).catch((error: unknown) => {
        this.diagnostics.failures++
        throw error
      }).finally(() => {
        if (this.pending.get(url) === request) this.pending.delete(url)
      })
      this.pending.set(url, request)
    }
    return JSON.parse(await request) as T
  }
}

export function debounce<T extends unknown[]>(fn: (...args: T) => void, delay = 300) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = (...args: T) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
  run.cancel = () => clearTimeout(timer)
  return run
}

export function throttle(fn: () => void, delay = 500) {
  let last = -Infinity
  return () => {
    const now = performance.now()
    if (now - last < delay) return
    last = now
    fn()
  }
}

export function canonicalQuery(params: URLSearchParams): string {
  const sorted = new URLSearchParams(params)
  sorted.sort()
  return sorted.toString()
}

// Aggregate counters only: URLs, query terms, tokens and bodies are never recorded.
const traffic = { started: 0, active: 0, failed: 0, aborted: 0 }
export function requestDiagnostics() { return { ...traffic } }
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  traffic.started++
  traffic.active++
  try {
    const response = await fetch(input, { credentials: "same-origin", cache: "no-store", ...init })
    if (!response.ok) traffic.failed++
    return response
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") traffic.aborted++
    else traffic.failed++
    throw error
  } finally { traffic.active-- }
}
