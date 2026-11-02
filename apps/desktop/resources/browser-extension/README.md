# Playwright Extension (bundled installation source)

The unmodified CRX3 package was downloaded from Google's official Chrome Web
Store update service for Microsoft's Playwright Extension. `catalog.json` pins
its version, source, size and SHA-256. The CRX3 publisher signature and manifest
public key both identify `mmlmfjhmonkocbjadbfplnigmagldckm`.

Microsoft currently documents Chrome Web Store installation for Edge as well:
https://github.com/microsoft/playwright-mcp/issues/1389

567 Agent offers an offline alternative: on explicit user action, verify this
package, extract it into a stable versioned directory, and open the selected
browser's extensions page. The browser still requires the user to enable
developer mode and select **Load unpacked**. This does not edit browser profiles,
enforce enterprise policy, or claim the extension is installed/connected.

The CRX itself is unchanged. During extraction only Chrome Web Store's reserved
`_metadata/` directory is omitted; executable code and `manifest.json` (including
its public key) remain byte-for-byte unchanged. Unpacked installations do not
receive store updates automatically. A future bundled version uses a new
directory; existing directories and browser choices are never overwritten.

Playwright is Copyright Microsoft Corporation, licensed under Apache-2.0; see
`LICENSE` and `NOTICE`. The bundled UI also includes React, React DOM and
Scheduler, Copyright Meta Platforms, Inc. and affiliates, under `LICENSE-react`.
Their notices in the upstream bundle are preserved. This redistribution does
not imply Microsoft endorsement of 567 Agent.

To update: download from the official service, verify the publisher's CRX3
signature and extension ID, update the catalog/checksum, and run the browser
bundle, settings flow, IPC and packaging regression tests. Do not substitute a
third-party extension with a similar name or fetch a floating version at runtime.
