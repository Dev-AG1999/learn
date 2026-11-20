# Browser requests and search caching

The employee directory keeps its server-rendered initial page and native GET fallback. With JavaScript enabled, filters use a 300 ms debounce, Apply filters has a 500 ms leading throttle, and pagination reuses the same JSON read cache. Refresh results clears that cache before searching.

`src/client/api.ts` provides the shared `apiFetch`, `requestDiagnostics`, `JsonReadCache`, debounce and throttle utilities. All existing application browser fetch calls use the wrapper. Diagnostics contain only aggregate started/active/failed/aborted counters, never URLs, query terms, bodies or credentials. Each cache also exposes network/hit/shared/failure counts. These exports are available for developer diagnostics; there is no polling or telemetry service.

Directory cache entries are JSON snapshots in memory, valid for 15 seconds, with at most 50 entries and LRU eviction. The initial server result seeds the cache. The cache belongs to the mounted HR directory and account; it is cleared on unmount, account/session broadcasts, or tab hiding. Writes navigate away from the directory, destroying its cache; returning obtains fresh server data. Other HR users' changes may remain unseen for at most the cache lifetime; Refresh results bypasses it immediately. No browser persistent storage is used.

Identical in-flight reads share a request; failures are never cached. Sequence checks prevent old results overwriting a newer search. Hidden tabs cancel pending search work and abort directory requests, with no automatic background search/refetch interval. Session status checks are coalesced only while in flight and remain fresh. Session renewal still uses the existing locks, idle limits and activity rules. Hidden tabs skip renewal broadcast status requests.

Salary writes, uploads, auth, permissions and signed links are not response-cached. Uploads and downloads use immediate pending guards rather than throttling away intentional subsequent operations. JavaScript-managed upload forms perform their own session verification, avoiding the redundant capture/replay check. Next.js server actions/native forms remain under the existing session guard and do not pass through `apiFetch`.

This is a focused read-cache implementation, not an offline database or a permanent API response store. AI and upload processing remain outside this directory read cache.

## Validation

275 unit/integration tests passed across 38 files, including actual SQLite directory filtering/validation and role restrictions, session-request coalescing without completed-auth caching, cache expiry/LRU/isolation/invalidation, initial-result reuse, debounce and throttle. TypeScript and the production build passed. The Chrome regression checks rapid typing makes one data request, submitting the same search reuses cached data, and explicit refresh fetches again; existing salary, claims, imports, Drive and responsive-layout checks also pass.

## Limits

The cache is intentionally scoped to the employee directory rather than permanent global storage. Other search forms use explicit server submissions and have no automatic per-keystroke API calls. Authorization, session renewal, mutations, uploads and signed downloads do not use the completed-result cache. Freshness after another HR user's edits is bounded by the 15-second lifetime, or immediate through Refresh results. No background polling was added. Request diagnostics cover browser fetches; they are not a server observability platform or rate limiter.
