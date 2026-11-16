import { refreshResponse } from "../../../src/auth/endpoints.ts"
export async function POST(request: Request) {
  return refreshResponse(request, false)
}
