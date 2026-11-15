import { loginResponse } from "../../../../src/auth/endpoints.ts"
export async function POST(request: Request) { return loginResponse(request, true) }
