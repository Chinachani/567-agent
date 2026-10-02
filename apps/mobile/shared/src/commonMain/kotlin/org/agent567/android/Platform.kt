package org.agent567.android

interface Platform {
    val name: String
}

expect fun getPlatform(): Platform