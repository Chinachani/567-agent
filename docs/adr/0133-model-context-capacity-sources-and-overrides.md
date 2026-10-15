# ADR-0133: Context capacity sources and per-model overrides

Date: 2026-10-15

## Context

The mobile NewAPI integration reduced model lists to IDs, so capacity stayed unknown and automatic compaction never reached its threshold. Desktop managed providers instead guessed capacity from family names. Their models were hidden from the ordinary custom-provider editor, and catalog refresh could overwrite configuration. Applying overrides only to built-in models, or retaining a session's initial model object, would leave a new capacity control disconnected from actual turn admission.

## Decision

- Capacity resolution uses a persisted manual override first, explicit input/context fields from the active provider second, and public reference data third. Exact model IDs use the refreshed models.dev capacity snapshot, with reviewed official values taking precedence. A small, explicit gateway alias table may reference a documented upstream model; those mappings are displayed as references rather than verified gateway limits. Unlisted aliases stay unknown. `max_tokens` alone is not interpreted as input capacity.
- Desktop stores overrides in the existing per-provider `modelOverrides`. A narrow serialized mutation changes only capacity, preserves credentials and other overrides, and keeps ordinary catalog replacement from overwriting or reviving manual values. A dedicated settings section includes managed providers.
- Model overrides apply after merging built-in, local and remote model sources. Existing runtime sessions refresh their selected model from the catalog when binding the next turn. A running turn retains its immutable binding.
- Mobile stores overrides and API metadata under separate, versioned keys scoped to server, group and model. The existing desktop catalog snapshot generator also emits a capacity and capability reference snapshot containing older model IDs and the mobile offline reference table. Reviewed official values and explicit aliases are maintained once in model-context-references.json; both clients consume the same generated data. API metadata has priority over that snapshot and expires after 12 hours per entry. Cache writes use the originating client server, so a late response cannot write into a newly selected server’s namespace.
- Mobile estimates context usage, reserves output space and checks the incoming input before submitting. Automatic compaction may reduce retained history from three recent turns to one when space is tight. If it still cannot fit, the draft and full conversation remain available and the user receives an actionable message.
- Legacy desktop family guesses remain runtime protection budgets during migration and are labelled unknown. Unknown values are not displayed as verified model limits. Desktop model configuration normalization supplies known reference capacities to both the settings reader and the runtime config adapter, so existing files do not need to wait for a server catalog refresh. Runtime protection budgets remain for unpublished limits.
- Mobile remote-desktop context remains owned by the desktop. Capacity and source are read-only on the phone; capacity changes are made in desktop settings. The existing context RPC gains an optional source field, with no new mutation method.

- Capacity editing accepts decimal K / M and binary Ki / Mi, always shows the exact token count, and provides common presets plus restoration of automatic detection. Desktop defaults to the active model, combines provider/model selection, supports search, and preserves unsaved drafts per model. Mobile keeps provenance behind optional disclosure.

- The shared reference catalog includes input/output modalities, independent input/output limits, tools, reasoning controls and sampling support/ranges when available. Both clients disclose these as read-only references with provenance, unknown fields and mode-dependent restrictions. They are not request defaults or a claim of gateway compatibility. The Kotlin generator splits initializer functions to respect JVM method-size limits.

## Alternatives and consequences

Using family-name defaults on both clients would be simpler but would misrepresent aliases and gateway-specific limits. A new model registry would duplicate the existing registry and credential persistence. The chosen design reuses the current configuration and turn-binding boundaries.

Catalog entries describe reference limits and cannot prove a gateway's effective limit. Manual settings do not enlarge provider limits. Input token estimates and image accounting remain approximate; this feature is not a billing meter. No paid probing requests or privileged gateway management endpoints are used to discover capacity.
