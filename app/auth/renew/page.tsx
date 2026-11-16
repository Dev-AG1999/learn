import { safeReturnTo } from "../../../src/auth/http.ts"
import { RenewSession } from "./renew-session.tsx"

export default async function RenewPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>
}) {
  const query = await searchParams
  return <RenewSession returnTo={safeReturnTo(query.returnTo ?? "/")} />
}
