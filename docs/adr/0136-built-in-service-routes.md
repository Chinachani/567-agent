# ADR-0136: Manual routes for the built-in account service

Date: 2026-10-20

## Context

The account service now has mainland and German ingress nodes backed by the same account database. Treating them as separate providers would split account tokens and model settings. Mutating a live client's address could move a running stream or a billable media request between nodes.

## Decision

- Discover the administrator-configured public API information list from `https://api.567.wiki/api/status` (`data.api_info`). This fixed bootstrap is distinct from the selected inference ingress. Do not expose or consume the root-only system instance list. Mainland (`https://a.567.wiki`) and Germany (`https://api.567.wiki`) remain offline fallbacks. No automatic selection or automatic retry accompanies a switch. Payment destinations remain server responses.
- New installations choose Germany, the same usable origin as discovery. This replaces the initial mainland default as of 2026-10-26 because that ingress has not opened. A missing route configuration also retains earlier releases' implicit German route. Saved explicit routes and mobile custom server addresses remain unchanged; the login-page selector can repair a previously saved mainland choice without clearing account data or waiting for discovery to finish.
- Desktop owns a separate versioned `service-route.json`. Its model settings reader and model runtime adapter project the chosen address only onto built-in provider IDs with exact trusted endpoints. Provider IDs, credentials and overrides keep their identity. The generic CLI stays independent of Desktop; an embedding host may provide its model runtime factory. Desktop and its Electron RPC children use the same adapter, which refreshes future catalog reads after a persisted route change. Active turn bindings remain immutable.
- Mobile retains immutable clients for the application container's lifetime and captures the client when a turn starts, including automatic compaction and image tools. It does not close the previous connection on a route switch. Discovered and previously selected managed endpoints share a stable cache identity; legacy capacity entries are migrated without merging custom server namespaces.
- The public `/api/status` check is anonymous, bounded, cancellable and rejects redirects. Logged-in switching also performs a read-only authenticated `/api/user/self` check against the exact destination before committing. Failure or cancellation preserves the existing login and route. Results from a different account state cannot commit a switch.
- Desktop and phone choices are independent. Remote model catalogs include an optional desktop service route for display; phones do not mutate desktop routing. Older desktops remain readable without that field.
- Cached routes render immediately while discovery runs in the background with an eight-second bound, a response-size limit, no credentials and no redirects. Valid lists are limited to 50 canonical HTTPS origins. Empty/malformed/disabled lists or network failures preserve the last valid catalog. Cache reads recover from corruption; selected routes and previously selected origin identities are durable configuration, so cache deletion cannot reset the selected route or split account/model settings. A selected route removed from a newer list remains available until the user changes it.
- Desktop discovery uses the application cache service namespace `service-routes`, separate from `service-route.json`. Both hosts use a five-minute freshness period and a short failure backoff; explicit refresh bypasses it. Discovery never changes a route or retries a model request.
- Login, account popover/profile and model settings reuse a compact selector. Network errors expose connection settings; switching never resubmits the failed task.

## Alternatives and consequences

Replacing all persisted URLs would conflate custom servers and built-in service identity and would require a transaction across multiple configuration files. Routing only in the UI would leave Runtime and IM requests using the old endpoint. The chosen adapter keeps a single route configuration and applies it at future request boundaries.

The displayed duration measures the status endpoint only. It does not predict model speed or prove real payment/media generation. Existing cross-node local media storage inconsistencies and German-to-mainland domain-based TLS failures (identified as Aliyun ICP access-filing blocking) are separate server concerns, not resolved by client switching. No privileged API calls or paid model probes are used.
