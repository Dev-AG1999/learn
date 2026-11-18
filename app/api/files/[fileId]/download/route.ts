import { downloadFileResponse } from "../../../../../src/files/http.ts"
export const runtime = "nodejs"
export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> }
) {
  return downloadFileResponse(request, (await context.params).fileId)
}
