package org.agent567.android.core.error

internal enum class ImagePayloadProblem { Missing, Invalid }

/** The UI supplies its localized message; diagnostics retain only this fixed category. */
internal class ImagePayloadException(val problem: ImagePayloadProblem, message: String) : IllegalStateException(message)
