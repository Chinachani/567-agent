package org.agent567.android.core.settings

import com.russhwolf.settings.Settings

/** Canonical writes with lazy, typed legacy reads. Removing a key clears both names. */
internal class Agent567Settings(private val delegate: Settings) : Settings by delegate {
    private fun legacy(key: String): String? = key.takeIf { it.startsWith("agent567.") }?.replaceFirst("agent567.", "vetta.")
    override val keys: Set<String> get() = delegate.keys.mapTo(mutableSetOf()) { if (it.startsWith("vetta.")) it.replaceFirst("vetta.", "agent567.") else it }
    override val size: Int get() = keys.size
    override fun hasKey(key: String): Boolean = delegate.hasKey(key) || legacy(key)?.let(delegate::hasKey) == true
    override fun remove(key: String) = synchronized(lock) { delegate.remove(key); legacy(key)?.let(delegate::remove); Unit }
    override fun clear() = synchronized(lock) { delegate.clear() }
    private fun <T> read(key: String, get: (String) -> T?, put: (String, T) -> Unit): T? = synchronized(lock) {
        if (delegate.hasKey(key)) return@synchronized get(key)
        val old = legacy(key)?.takeIf(delegate::hasKey) ?: return@synchronized null
        get(old)?.also { put(key, it) }
    }
    override fun getStringOrNull(key: String): String? = read(key, delegate::getStringOrNull, delegate::putString)
    override fun getString(key: String, defaultValue: String): String = getStringOrNull(key) ?: defaultValue
    override fun putString(key: String, value: String) = synchronized(lock) { delegate.putString(key, value); legacy(key)?.let(delegate::remove); Unit }
    override fun getIntOrNull(key: String): Int? = read(key, delegate::getIntOrNull, delegate::putInt)
    override fun getInt(key: String, defaultValue: Int): Int = getIntOrNull(key) ?: defaultValue
    override fun putInt(key: String, value: Int) = synchronized(lock) { delegate.putInt(key, value); legacy(key)?.let(delegate::remove); Unit }
    override fun getLongOrNull(key: String): Long? = read(key, delegate::getLongOrNull, delegate::putLong)
    override fun getLong(key: String, defaultValue: Long): Long = getLongOrNull(key) ?: defaultValue
    override fun putLong(key: String, value: Long) = synchronized(lock) { delegate.putLong(key, value); legacy(key)?.let(delegate::remove); Unit }
    override fun getBooleanOrNull(key: String): Boolean? = read(key, delegate::getBooleanOrNull, delegate::putBoolean)
    override fun getBoolean(key: String, defaultValue: Boolean): Boolean = getBooleanOrNull(key) ?: defaultValue
    override fun putBoolean(key: String, value: Boolean) = synchronized(lock) { delegate.putBoolean(key, value); legacy(key)?.let(delegate::remove); Unit }
    override fun getFloatOrNull(key: String): Float? = read(key, delegate::getFloatOrNull, delegate::putFloat)
    override fun getFloat(key: String, defaultValue: Float): Float = getFloatOrNull(key) ?: defaultValue
    override fun putFloat(key: String, value: Float) = synchronized(lock) { delegate.putFloat(key, value); legacy(key)?.let(delegate::remove); Unit }
    override fun getDoubleOrNull(key: String): Double? = read(key, delegate::getDoubleOrNull, delegate::putDouble)
    override fun getDouble(key: String, defaultValue: Double): Double = getDoubleOrNull(key) ?: defaultValue
    override fun putDouble(key: String, value: Double) = synchronized(lock) { delegate.putDouble(key, value); legacy(key)?.let(delegate::remove); Unit }
    private companion object { val lock = Any() }
}
