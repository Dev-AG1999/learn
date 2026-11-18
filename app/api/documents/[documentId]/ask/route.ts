import { askResponse } from "../../../../../src/document-ai/http.ts"
export const runtime = "nodejs"
export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> }
) {
  return askResponse(request, (await context.params).documentId)
}
