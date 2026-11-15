import { logoutResponse } from "../../../src/auth/endpoints.ts"
export async function POST(request: Request) { return logoutResponse(request, false) }
