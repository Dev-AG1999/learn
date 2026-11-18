import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ollamaProvider, LOCAL_VECTOR_SIZE } from "../src/document-ai/ollama.ts"
import { languageProvider } from "../src/document-ai/provider.ts"
import {
  documentAiConfigured,
  ollamaBaseUrl,
} from "../src/document-ai/config.ts"
import { openDocumentRepository } from "../src/document-ai/repository.ts"
import { askDocument, uploadDocument } from "../src/document-ai/service.ts"

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "ollama")
  vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
  vi.stubEnv("OLLAMA_CHAT_MODEL", "qwen3:4b")
  vi.stubEnv("OPENAI_API_KEY", "")
  vi.stubEnv("AI_DOCUMENTS_ENABLED", "true")
  for (const key of [
    "AWS_REGION",
    "AI_S3_BUCKET",
    "QDRANT_URL",
    "QDRANT_API_KEY",
  ])
    vi.stubEnv(key, "test-only")
  for (const key of [
    "LANGSMITH_TRACING",
    "LANGCHAIN_TRACING_V2",
    "LANGCHAIN_TRACING",
  ])
    vi.stubEnv(key, "false")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type Recorded = {
  url: string
  body: Record<string, unknown>
  options: RequestInit
}
function localServer(
  requests: Recorded[],
  overrides: { invalidVector?: boolean; badAnswer?: boolean } = {}
): typeof fetch {
  return async (input, options) => {
    const url = String(input)
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>
    requests.push({ url, body, options: options ?? {} })
    if (!url.startsWith("http://127.0.0.1:11434/"))
      throw new Error("Unexpected remote request")
    if (url.endsWith("/api/embed"))
      return Response.json({
        model: "nomic-embed-text:v1.5",
        embeddings: (body.input as string[]).map(() =>
          Array(overrides.invalidVector ? 1 : LOCAL_VECTOR_SIZE).fill(0.1)
        ),
      })
    if (url.endsWith("/api/chat")) {
      const content = overrides.badAnswer
        ? "invalid JSON"
        : JSON.stringify({
            answer: "Other deductions are 5000. The reason is not stated.",
            sourceIndexes: [0],
          })
      // ChatOllama uses the streaming endpoint even when invoke returns one answer.
      return new Response(
        JSON.stringify({
          model: "qwen3:4b",
          created_at: "2026-11-16T00:00:00Z",
          message: { role: "assistant", content },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 10,
          eval_count: 10,
        }) + "\n",
        { headers: { "Content-Type": "application/x-ndjson" } }
      )
    }
    throw new Error("Unexpected path")
  }
}

test("local configuration works without an OpenAI key; unknown providers fail closed", () => {
  expect(documentAiConfigured()).toBe(false)
  expect(languageProvider().embeddingProfile).toBe("ollama-nomic-v1")
  vi.stubEnv("AI_PROVIDER", "openai")
  expect(documentAiConfigured()).toBe(false)
  vi.stubEnv("AI_PROVIDER", "unknown")
  expect(documentAiConfigured()).toBe(false)
  expect(() => languageProvider()).toThrow("AI_PROVIDER")
})
test("rejects remote, credential-bearing, redirected-path and unsupported cloud configurations", () => {
  for (const url of [
    "http://remote.test:11434",
    "https://ollama.com",
    "http://user:password@localhost:11434",
    "http://localhost:11434/proxy",
    "http://localhost:11434?target=remote",
  ]) {
    vi.stubEnv("OLLAMA_BASE_URL", url)
    expect(documentAiConfigured()).toBe(false)
    expect(() => ollamaBaseUrl()).toThrow()
  }
  vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
  vi.stubEnv("OLLAMA_CHAT_MODEL", "gpt-oss:120b-cloud")
  expect(() => ollamaProvider()).toThrow("supported local Qwen3")
})
test("local SDK requests use Nomic prefixes, bounded batches and schema-constrained Qwen without cloud calls", async () => {
  const requests: Recorded[] = []
  const provider = ollamaProvider({ fetch: localServer(requests) })
  expect(
    await provider.embedDocuments(Array(10).fill("private document"))
  ).toHaveLength(10)
  expect(await provider.embedQuery("deductions")).toHaveLength(768)
  const answer = await provider.answer("Why the deduction?", [
    { index: 0, page: 1, text: "Other deductions 5000" },
  ])
  expect(answer.sourceIndexes).toEqual([0])
  const embeds = requests.filter((request) =>
    request.url.endsWith("/api/embed")
  )
  expect(
    embeds.map((request) => (request.body.input as string[]).length)
  ).toEqual([8, 2, 1])
  expect((embeds[0].body.input as string[])[0]).toBe(
    "search_document: private document"
  )
  expect(embeds[2].body.input).toEqual(["search_query: deductions"])
  expect(embeds[0].body.truncate).toBe(false)
  const chat = requests.find((request) => request.url.endsWith("/api/chat"))!
  expect(chat.body.model).toBe("qwen3:4b")
  expect(chat.body.think).toBe(false)
  expect(chat.body.format).toMatchObject({ type: "object" })
  expect(chat.body).not.toHaveProperty("tools")
  expect(
    requests.every(
      (request) =>
        request.options.redirect === "error" &&
        request.options.signal instanceof AbortSignal
    )
  ).toBe(true)
})
test("wrong embedding dimensions and malformed answers are rejected", async () => {
  await expect(
    ollamaProvider({
      fetch: localServer([], { invalidVector: true }),
    }).embedQuery("question")
  ).rejects.toThrow("invalid vectors")
  await expect(
    ollamaProvider({ fetch: localServer([], { badAnswer: true }) }).answer(
      "question",
      [{ index: 0, page: 1, text: "Deduction 5000" }]
    )
  ).rejects.toThrow()
})
test("local service outage never falls back to paid OpenAI", async () => {
  const requests: string[] = []
  const provider = ollamaProvider({
    fetch: async (input) => {
      requests.push(String(input))
      throw new Error("Ollama not running")
    },
  })
  await expect(provider.embedQuery("question")).rejects.toThrow()
  expect(requests.length).toBeGreaterThan(0)
  expect(
    requests.every((url) => url.startsWith("http://127.0.0.1:11434/"))
  ).toBe(true)
})
test("local SDK, persisted document passages and LangGraph answer work together without OpenAI", async () => {
  const repository = openDocumentRepository(":memory:")
  const principal = {
    userId: "employee-a",
    username: "a@example.test",
    role: "employee" as const,
    employeeId: "emp-a",
  }
  const requests: Recorded[] = []
  try {
    const deps = {
      repository,
      language: ollamaProvider({ fetch: localServer(requests) }),
      objects: {
        put: vi.fn(async () => {}),
        get: vi.fn(async () => new Uint8Array()),
        remove: vi.fn(async () => {}),
      },
      vectors: {
        put: vi.fn(async () => {}),
        search: vi.fn(async () => [0]),
        remove: vi.fn(async () => {}),
      },
      extract: async () => ({
        pages: 1,
        passages: [
          {
            index: 0,
            page: 1,
            text: "Other deductions 5000. Reason not stated.",
          },
        ],
      }),
    }
    const document = await uploadDocument(
      principal,
      "test.pdf",
      new Uint8Array(),
      deps
    )
    expect(repository.access(principal, document.id).embeddingProfile).toBe(
      "ollama-nomic-v1"
    )
    expect(
      (await askDocument(principal, document.id, "Explain deductions", deps))
        .citations[0].page
    ).toBe(1)
    expect(
      requests.every((request) =>
        request.url.startsWith("http://127.0.0.1:11434/")
      )
    ).toBe(true)
    deps.language = { ...deps.language, embeddingProfile: "openai-v1" }
    const count = requests.length
    await expect(
      askDocument(principal, document.id, "Explain deductions", deps)
    ).rejects.toMatchObject({ status: 409 })
    expect(requests).toHaveLength(count)
  } finally {
    repository.close()
  }
})
test("existing document databases migrate to the original OpenAI profile without losing rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-profile-migration-")),
    path = join(dir, "db.sqlite")
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE ai_documents (id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, ownerName TEXT NOT NULL, name TEXT NOT NULL, objectKey TEXT NOT NULL UNIQUE, pages INTEGER NOT NULL, status TEXT NOT NULL, createdAt INTEGER NOT NULL);
    INSERT INTO ai_documents VALUES ('existing', 'user', 'name', 'file.pdf', 'key', 1, 'ready', 0);`)
  db.close()
  const migrated = openDocumentRepository(path)
  try {
    expect(
      migrated.access({ userId: "user", role: "employee" }, "existing")
        .embeddingProfile
    ).toBe("openai-v1")
  } finally {
    migrated.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
