import { sessionResponse } from "../../../../src/auth/endpoints.ts"
export async function GET(request: Request) { return sessionResponse(request) }
