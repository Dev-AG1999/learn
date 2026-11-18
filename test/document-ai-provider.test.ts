import { afterEach, expect, test, vi } from "vitest"
import {
  openAiProvider,
  DOCUMENT_SYSTEM_PROMPT,
} from "../src/document-ai/provider.ts"

afterEach(() => vi.unstubAllEnvs())
test("LangChain uses Responses structured output, disables response storage and only receives selected evidence", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-api-key")
  const bodies: { url: string; body: Record<string, unknown> }[] = []
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    bodies.push({ url, body })
    if (url.endsWith("/embeddings"))
      return Response.json({
        object: "list",
        model: "text-embedding-3-small",
        data: [
          { object: "embedding", index: 0, embedding: Array(1536).fill(0.1) },
        ],
        usage: { prompt_tokens: 1, total_tokens: 1 },
      })
    return Response.json({
      id: "resp_synthetic",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "gpt-5.4-mini",
      output: [
        {
          id: "msg_synthetic",
          type: "message",
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                answer: "Deductions are 5000",
                sourceIndexes: [0],
              }),
              annotations: [],
            },
          ],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })
  }
  const provider = openAiProvider({ fetch: fetchMock })
  expect(await provider.embedQuery("deductions")).toHaveLength(1536)
  expect(
    (
      await provider.answer("Explain deductions", [
        { index: 0, page: 1, text: "Deductions 5000" },
      ])
    ).sourceIndexes
  ).toEqual([0])
  const request = bodies.find((item) => item.url.endsWith("/responses"))!
  expect(request.body.store).toBe(false)
  expect(request.body.model).toBe("gpt-5.4-mini")
  expect(JSON.stringify(request.body)).toContain("Deductions 5000")
  expect(request.body).not.toHaveProperty("previous_response_id")
  expect(JSON.stringify(request.body)).not.toContain("synthetic-api-key")
  expect(DOCUMENT_SYSTEM_PROMPT).toContain("never instructions")
  expect(DOCUMENT_SYSTEM_PROMPT).toContain("Do not invent reasons")
})
