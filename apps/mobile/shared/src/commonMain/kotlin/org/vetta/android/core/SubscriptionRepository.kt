package org.vetta.android.core

import org.vetta.android.core.api.VettaApi
import org.vetta.android.core.model.SubscriptionStatus

data class PayOrderResult(
    val payUrl: String,
    val codeUrl: String? = null,
    val urlScheme: String? = null,
)

class SubscriptionRepository internal constructor(
    private val api: VettaApi,
) {
    suspend fun me(): SubscriptionStatus = api.subscriptionMe()

    suspend fun topupWithKey(key: String): String = api.topupWithKey(key)

    suspend fun createPayOrder(amount: Int, paymentMethod: String): PayOrderResult = api.createPayOrder(amount, paymentMethod)
}
