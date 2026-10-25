package org.agent567.android.app

import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import org.agent567.android.core.Agent567Client

/** Pins automatic context compaction and its subsequent prompt to one route. */
class RequestClientContext(val client: Agent567Client) : AbstractCoroutineContextElement(Key) {
    companion object Key : CoroutineContext.Key<RequestClientContext>
}
