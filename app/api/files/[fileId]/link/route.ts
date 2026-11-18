import { signedLinkResponse } from "../../../../../src/files/http.ts"
export const runtime = "nodejs"
export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> }
) {
  return signedLinkResponse(request, (await context.params).fileId)
}
