import { downloadResponse } from "../../../../../src/document-ai/http.ts"
export const runtime = "nodejs"
export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> }
) {
  return downloadResponse(request, (await context.params).documentId)
}
