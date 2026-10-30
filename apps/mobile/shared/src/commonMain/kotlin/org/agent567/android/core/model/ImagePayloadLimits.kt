package org.agent567.android.core.model

/** Shared by image transfer validation and durable chat image storage. */
internal const val MAX_IMAGE_PAYLOAD_BYTES = 12 * 1024 * 1024
internal const val MAX_IMAGE_PAYLOAD_BASE64_CHARS = ((MAX_IMAGE_PAYLOAD_BYTES + 2) / 3) * 4 + 8
