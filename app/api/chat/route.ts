import { z } from "zod"
import { filePrincipal } from "../../../src/files/auth.ts"
import { fileFailure } from "../../../src/files/http.ts"
import { boundedBytes } from "../../../src/files/bytes.ts"
import { readPeriod } from "../../../src/period.ts"
import { chat } from "../../../src/ai/chat.ts"
import { DocumentError } from "../../../src/document-ai/types.ts"
const schema = z.object({
  question: z.string().min(1).max(2000),
  employeeId: z.string().max(64).optional(),
  year: z.number().int(),
  month: z.number().int(),
  attachments: z
    .array(z.string().regex(/^[\w-]{1,100}$/))
    .max(2)
    .default([]),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(6000),
      })
    )
    .max(6)
    .default([]),
})
export const runtime = "nodejs"
export async function POST(request: Request) {
  try {
    const principal = await filePrincipal(request)
    const parsed = schema.safeParse(
      JSON.parse(
        new TextDecoder().decode(await boundedBytes(request.body, 50000))
      )
    )
    if (!parsed.success)
      throw new DocumentError(
        "Choose a valid question, conversation and payroll period."
      )
    const input = parsed.data
    const period = readPeriod(String(input.year), String(input.month))
    if (!period) throw new DocumentError("Choose a valid payroll period.")
    return Response.json(
      await chat(
        principal,
        { ...period, employeeId: input.employeeId },
        input.question,
        input.history,
        input.attachments
      ),
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json(
        { error: "Send a valid chat request." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      )
    return error instanceof DocumentError
      ? Response.json(
          { error: error.message },
          { status: error.status, headers: { "Cache-Control": "no-store" } }
        )
      : fileFailure(error)
  }
}
