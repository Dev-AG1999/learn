export function AccountNav() {
  return <nav aria-label="Account" style={{ display: "flex", gap: 24, alignItems: "center", marginBottom: 24 }}>
    <a href="/">My workspace</a>
    <form action="/auth/logout" method="post"><button type="submit">Sign out</button></form>
  </nav>
}
