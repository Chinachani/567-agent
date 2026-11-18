package org.agent567.android.domain.remote

enum class RemoteScreenStage { Connecting, WaitingForScreen, Negotiating, WaitingForFrame, Receiving, Reconnecting, Ended }
enum class RemoteVideoPreference(val wire: String) { Auto("auto"), Smooth("smooth"), Clear("clear") }
