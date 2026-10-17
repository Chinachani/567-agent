---
status: accepted
---

# Session workbench, context selection and reversible file review

Date: 2026-10-16

## Context

Context capacity controls did not explain which conversation material was selected. Attachments, task results and tool diffs were scattered through long timelines. Adding independent global pages would obscure their session ownership. Changing stored conversation messages to filter model input would destroy history and break tool chains.

## Decision

- Keep one session workbench with Context, Attachments, Tasks and Changes. Desktop uses a wide dialog; mobile uses a full-screen scrolling surface. Capacity controls remain under model settings or the mobile context sheet. Long summaries and model references have independent previews.
- Desktop owns a versioned per-conversation `.context.json` published pointer. The existing pinned-context turn binder captures that pointer synchronously, projects complete excluded turns out of model input and compaction, and protects explicit pinned reference text. Conversation journals are unchanged. Updating a selection checks session identity, policy revision and document revision. Existing summaries are invalidated when exclusions change, so they cannot reintroduce excluded material. Input-context records preceding a user message belong to that user turn.
- Mobile API selection is owned by `MobileContextManager` and stored in `MobileSessionContext`. Exclusions are by user turn, pinned text is budgeted independently, and summary changes remain transactional. Reset retains the timeline while clearing selected context and pinned references. Backups retain these fields. Imported summaries remain reference data; imported boundaries and explicit exclusions are mapped to destination entry IDs.
- Session task history is projected from persisted messages, tool results and timing facts. Reading results never submits a generation request. A missing terminal result is labelled interrupted after the runtime is no longer running. Mobile API requests are not claimed to support server-side resumption.
- Attachment previews and original downloads accept only IDs already present in the session, resolve workspace paths or literal explicitly attached files and bound reads. Original downloads use 64 KiB chunks, a 12 MiB limit and a stable file version check. Preview text is bounded to 32 KiB. Reading scopes are explicit user instructions to the agent; they are not a claim of successful parsing. The existing mobile API file support boundary is retained.
- Native Node edit/write tools may include a versioned small UTF-8 before/after receipt in local result details. It is not model-facing tool text. Complete snapshots are capped at 64 KiB per version. Desktop review checks the current file hash, refuses changed files, preserves a recovery backup and uses the existing revision-checked save boundary. Mobile review is read-only. Large, binary, command and external-tool changes do not acquire a fictitious undo capability.
- Optional remote functions are advertised by capability. Mobile can send their logical method inside the established `session.context` payload envelope; existing blind relays can continue validating and forwarding the outer frame. New clients do not send unsupported operations to older desktops. No pairing or certificate reset accompanies these features.
- Diagnostics stays global. Default packages contain a previewable allowlisted environment summary. Recent logs require explicit opt-in and common credential/path redaction. Runtime repair reuses the existing runtime manager; it does not silently rotate pairing secrets or submit paid model requests.

## Alternatives and consequences

Rewriting journals for context selection was rejected because it loses history and makes tool pairing fragile. Duplicating execution to “recover” a result was rejected because it can repeat billable operations. Universal filesystem snapshots or silent rollback were rejected because they can exhaust storage or overwrite later work.

The workbench lists recent bounded records and loads one detail at a time. Previews are not full exports. A summary is lossy reference data. Reading scope instructions depend on the selected agent and file tools. External aliases and arbitrary paths are not exposed over remote preview/download, and backups may be required to inspect older changes.
