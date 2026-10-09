package org.agent567.android.core

import org.agent567.android.core.api.Agent567Api
import org.agent567.android.core.model.SubscriptionStatus

data class PayOrderResult(
    val payUrl: String,
    val codeUrl: String? = null,
    val urlScheme: String? = null,
)

class SubscriptionRepository internal constructor(
    private val api: Agent567Api,
) {
    suspend fun me(): SubscriptionStatus = api.subscriptionMe()

    suspend fun topupWithKey(key: String): String = api.topupWithKey(key)

    suspend fun createPayOrder(amount: Int, paymentMethod: String): PayOrderResult = api.createPayOrder(amount, paymentMethod)
}
