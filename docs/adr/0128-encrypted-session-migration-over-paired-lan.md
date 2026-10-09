# ADR 0128: Encrypted session migration over paired LAN

- Status: Accepted
- Date: 2026-10-08

## Context

Mobile users need to move chat history to the paired desktop without routing a potentially large archive through a cloud relay. Session migration archives are already encrypted with a user supplied passphrase.

## Decision

The desktop advertises migration transfer methods only for a paired local connection authenticated with the pinned local TLS certificate. Cloud relay connections never advertise or accept these methods.

The mobile client sends the encrypted archive in ordered chunks of at most 256 KiB. The desktop limits an archive to 200 MiB, checks the declared SHA-256 digest, allows only one active transfer, expires idle transfers, and clears in-memory buffers on cancellation or connection shutdown.

Finishing a transfer prompts the desktop user with the archive size and an explicit accept or cancel choice. The desktop retains the encrypted archive only after acceptance. The mobile client sends the passphrase in a separate import request after that response, so a desktop user can reject the transfer before the password crosses the connection. Import decrypts and validates the archive before applying it through the existing session migration service.

Older clients remain compatible through the existing `session.list` method negotiation. They do not advertise the transfer methods, so mobile does not start a transfer.

## Consequences

- The archive and passphrase are transferred only across the paired LAN TLS connection.
- The desktop user must approve every incoming archive.
- A failed import consumes the one-time approval; the mobile user must initiate a new transfer.
- Transfers are bounded and memory resident. They are not resumable after disconnect or desktop restart.
