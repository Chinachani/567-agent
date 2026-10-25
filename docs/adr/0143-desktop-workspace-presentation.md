# ADR-0143: Desktop workspace presentation

- Status: accepted
- Date: 2026-10-25

## Context

The user requested a comprehensive desktop redesign and authorized replacing the old appearance while preserving product functions. Individual pages had unrelated heading sizes, gradients, margins and fixed three-column layouts. Settings rows truncated explanatory text and could compress controls in narrow content panes. The input toolbar combined model/context controls with attachment/send actions.

## Decision

Use the existing theme tokens, shared primitives and theme override slots. Add the props-only `WorkspacePageHeader` export to `@vetta-org/theme-ui/shared`; settings, automation, batch work and capabilities use the same heading hierarchy. Keep connected page models and persistence ownership in the desktop host. No existing public props are removed.

Rearrange the existing input view into model/context and editor/attachment/send levels. Keep one editor, the same action handlers and all existing permission, cancellation, queue and theme-surface boundaries. Settings rows wrap at their actual available width. Page grids use bounded minimum columns. The default mono palette raises muted text contrast, while custom themes continue to supply their own values.

The alternative was page-specific CSS patches. That would retain duplicate page headings and inconsistent responsive behavior. Replacing the theme runtime, navigation model or business state would add migration risk without helping the presentation task, so those owners remain in place.

## Validation and limits

Component tests cover task actions, settings navigation, account/menu/dialog focus and existing chat contracts. An isolated Electron probe renders production views with fixture data, blocks HTTP(S), and checks layout plus common input/create actions. A separate existing probe checks real titlebar commands, footer, providers and guide scrolling. Both run in the Linux packaging regression job through precise changed-path rules.

Fixture screenshots describe presentation with sample page models; they do not establish real-account behavior, OS permission handling, plugin-specific visual quality or Windows native installer acceptance. This decision changes no stored user data, model routing, API behavior or payment policy.

## Settings navigation follow-up (2026-10-25)

Settings uses its own two-column shell. The main workspace sidebar and its hover overlay are absent only while visiting `/settings/*`; width and collapse preferences are retained. A memory-only UI atom records the previous workspace href on entry, and the return action uses the router history adapter. Switching settings tabs does not replace that destination. The account menu routes straight to General settings, and the main navigation catalog no longer duplicates configuration tabs. Theme slots and window chrome remain available.

The user chose to consolidate image selectors in Model settings. The existing image-generation configuration and provider/model precedence are unchanged; the legacy `agent-images` section ID now resolves to the Models tab, so existing section links redirect there. Agent personalization and behavior switches remain visible; runtime options are disclosed on demand and expand for a matching section link. Retired ornament/texture controls no longer subscribe or render in Appearance, while their stored configuration remains readable for compatibility.

The archive screen manages projects, rather than deleted conversations. Its labels now name projects explicitly, and project rows expose the existing archive context menu through a named button. `ProjectRowView.contextMenuTitle` is optional, keeping callers without that action unchanged. Ability cards use a stretched primary details button with a separate elevated action area, so the entire card is keyboard/pointer accessible without nesting buttons or intercepting the add/menu action.
