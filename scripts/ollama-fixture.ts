import { createServer } from "node:http"
/** Synthetic local protocol fixture; never used by application runtime. */
export function ollamaFixture() {
  return createServer(async (request, response) => {
    try {
      const parts: Buffer[] = []
      let size = 0
      for await (const part of request) {
        size += part.length
        if (size > 100000) throw new Error("Fixture request too large")
        parts.push(Buffer.from(part))
      }
      const body = JSON.parse(Buffer.concat(parts).toString()) as {
        input?: string[]
        format?: { properties?: Record<string, unknown> }
      }
      if (request.url === "/api/embed") {
        response.setHeader("Content-Type", "application/json")
        response.end(
          JSON.stringify({
            model: "nomic-embed-text:v1.5",
            embeddings: body.input?.map(() => Array(768).fill(0.1)),
          })
        )
      } else if (request.url === "/api/chat") {
        response.setHeader("Content-Type", "application/x-ndjson")
        response.end(
          JSON.stringify({
            model: "qwen3:4b",
            created_at: "2026-11-19T00:00:00Z",
            message: {
              role: "assistant",
              content: JSON.stringify(
                body.format?.properties?.needsReview
                  ? {
                      needsReview: false,
                      summary:
                        "Synthetic AI upload review completed; required validation remains authoritative.",
                      checks: [],
                    }
                  : {
                      answer:
                        "The PDF contains salary details. Check the cited text for the amounts and stated reasons.",
                      sourceIndexes: [0],
                    }
              ),
            },
            done: true,
            done_reason: "stop",
            prompt_eval_count: 10,
            eval_count: 10,
          }) + "\n"
        )
      } else {
        response.statusCode = 404
        response.end()
      }
    } catch {
      response.statusCode = 400
      response.end()
    }
  })
}
