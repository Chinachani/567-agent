package org.agent567.android.app

import org.agent567.android.core.settings.Agent567Settings
import com.russhwolf.settings.Settings
import com.russhwolf.settings.set
import io.ktor.http.Url
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.agent567.android.core.model.ModelContextMetadata
import org.agent567.android.core.model.CachedModelContext
import org.agent567.android.core.model.validModelContext
import org.agent567.android.core.net.Agent567Json
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.agent567.android.core.auth.SecretStore
import org.agent567.android.core.auth.SettingsSecretStore
import org.agent567.android.data.session.MIGRATION_BACKUP_LIMIT_OPTIONS_MB
import org.agent567.android.core.ServiceRoute
import org.agent567.android.core.ServiceRouteCatalog
import org.agent567.android.core.normalizeServiceOrigin
import org.agent567.android.core.serviceIdentity

enum class ThemeMode {
    System,
    Light,
    Dark,
    ;

    companion object {
        fun fromStorage(value: String?): ThemeMode =
            entries.firstOrNull { it.name == value } ?: Light
    }
}

/**
 * 应用级偏好：服务器、主题、上次会话/模型和本地交互策略。
 * 与 TokenStore 分离，避免鉴权与产品偏好耦合。
 */
class AppPreferences(
    settings: Settings = Settings(),
    private val secretStore: SecretStore = SettingsSecretStore(settings),
) {
    // Earlier versions allowed a manually entered server without route history.
    private val legacyServerWasSaved = settings.hasKey("vetta.prefs.server_url")
    private val storage = Agent567Settings(settings)

    var availableUpdateVersion: String
        get() = storage.getString("agent567.update.available.v1", "")
        set(value) { storage["agent567.update.available.v1"] = value }
    var updateCheckedForVersion: String
        get() = storage.getString("agent567.update.current.v1", "")
        set(value) { storage["agent567.update.current.v1"] = value }
    var lastUpdateCheckAt: Long
        get() = storage.getLong("agent567.update.last-check.v1", 0L)
        set(value) { storage["agent567.update.last-check.v1"] = value }
    var notifiedUpdateVersion: String
        get() = storage.getString("agent567.update.notified.v1", "")
        set(value) { storage["agent567.update.notified.v1"] = value }

    /** GitHub Release download routing: github (direct), gh-proxy, or custom. */
    var downloadSource: String
        get() = storage.getStringOrNull(KEY_DOWNLOAD_SOURCE)
            ?.takeIf { it == DOWNLOAD_SOURCE_GH_PROXY || (it == DOWNLOAD_SOURCE_CUSTOM && customPrefix.isNotBlank()) }
            ?: DOWNLOAD_SOURCE_GITHUB
        set(value) {
            require(value == DOWNLOAD_SOURCE_GITHUB || value == DOWNLOAD_SOURCE_GH_PROXY || value == DOWNLOAD_SOURCE_CUSTOM) {
                "Unsupported GitHub download source"
            }
            storage[KEY_DOWNLOAD_SOURCE] = value
        }

    /** Validated HTTPS URL prefix for custom GitHub Release downloads; empty when unset/invalid. */
    var customPrefix: String
        get() = normalizeGitHubDownloadPrefix(storage.getStringOrNull(KEY_DOWNLOAD_CUSTOM_PREFIX)).orEmpty()
        set(value) {
            if (value.isBlank()) {
                storage.remove(KEY_DOWNLOAD_CUSTOM_PREFIX)
                return
            }
            val normalized = normalizeGitHubDownloadPrefix(value)
                ?: throw IllegalArgumentException("Custom download prefix must be a valid HTTPS URL without credentials, query, or fragment")
            storage[KEY_DOWNLOAD_CUSTOM_PREFIX] = normalized
        }

    private fun cachedServiceRoutes(): ServiceRouteCatalog? = runCatching {
        Agent567Json.decodeFromString<ServiceRouteCatalog>(storage.getStringOrNull("567agent.service-routes.catalog.v1") ?: return null)
            .takeIf { it.routes.isNotEmpty() && it.routes.size <= 50 && it.routes.all { route -> normalizeServiceOrigin(route.origin) == route.origin } && it.updatedAt != null && it.updatedAt > 0 }
    }.getOrNull()

    private fun knownServiceRoutes(): List<ServiceRoute> = runCatching {
        Agent567Json.decodeFromString<List<String>>(storage.getString("567agent.service-routes.known.v1", "[]"))
            .filter { normalizeServiceOrigin(it) == it }.takeLast(200).map { ServiceRoute(it) }
    }.getOrDefault(emptyList())

    private val trustedServiceRoutes: List<ServiceRoute>
        get() = (cachedServiceRoutes()?.routes.orEmpty() + ServiceRoute.entries + knownServiceRoutes()).distinctBy { it.origin }

    fun findServiceRoute(server: String): ServiceRoute? = ServiceRoute.fromServer(server, trustedServiceRoutes)

    fun serviceIdentity(server: String): String = serviceIdentity(server, trustedServiceRoutes)

    fun serviceRouteCatalog(): ServiceRouteCatalog {
        val cached = cachedServiceRoutes()
        val routes = (cached?.routes ?: ServiceRoute.entries).toMutableList()
        findServiceRoute(serverUrl.value)?.let { current -> if (routes.none { it.origin == current.origin }) routes.add(current) }
        return (cached ?: ServiceRouteCatalog()).copy(routes = routes, source = if (cached == null) "builtin" else "cache", refreshFailed = false)
    }

    fun cacheServiceRoutes(routes: List<ServiceRoute>) {
        require(routes.isNotEmpty() && routes.size <= 50 && routes.all { normalizeServiceOrigin(it.origin) == it.origin })
        storage["567agent.service-routes.catalog.v1"] = Agent567Json.encodeToString(ServiceRouteCatalog(routes, System.currentTimeMillis(), "cache"))
    }

    fun rememberServiceRoute(route: ServiceRoute) {
        val known = (knownServiceRoutes() + listOfNotNull(findServiceRoute(serverUrl.value)) + route).map { it.origin }.distinct().takeLast(200)
        storage["567agent.service-routes.known.v1"] = Agent567Json.encodeToString(known)
    }

    private val _serverUrl = MutableStateFlow(readServerUrl())
    val serverUrl: StateFlow<String> = _serverUrl.asStateFlow()

    init {
        // Canonicalize the two exact built-in endpoints, keeping custom overrides isolated.
        val prefix = "567agent.model-context.v1."
        storage.keys.filter { it.startsWith(prefix) }.forEach { key ->
            runCatching {
                val parts = Agent567Json.parseToJsonElement(key.removePrefix(prefix)) as? JsonArray ?: return@runCatching
                val server = (parts.firstOrNull() as? JsonPrimitive)?.content ?: return@runCatching
                if (findServiceRoute(server) == null) return@runCatching
                val canonical = prefix + JsonArray(listOf(JsonPrimitive(serviceIdentity(server))) + parts.drop(1)).toString()
                if (canonical != key) {
                    if (!storage.hasKey(canonical)) storage.getStringOrNull(key)?.let { storage[canonical] = it }
                    storage.remove(key)
                }
            }
        }
    }

    private val _themeMode = MutableStateFlow(ThemeMode.fromStorage(storage.getStringOrNull(KEY_THEME)))
    val themeMode: StateFlow<ThemeMode> = _themeMode.asStateFlow()

    private val _autoResumeLastSession = MutableStateFlow(readBoolean(KEY_AUTO_RESUME, false))
    val autoResumeLastSession: StateFlow<Boolean> = _autoResumeLastSession.asStateFlow()

    private val _motionEnabled = MutableStateFlow(readBoolean(KEY_MOTION_ENABLED, true))
    val motionEnabled: StateFlow<Boolean> = _motionEnabled.asStateFlow()

    private val _inputPredictionEnabled = MutableStateFlow(readBoolean(KEY_INPUT_PREDICTION_ENABLED, true))
    val inputPredictionEnabled: StateFlow<Boolean> = _inputPredictionEnabled.asStateFlow()

    private val _autoRequestDesktopScreen = MutableStateFlow(readBoolean(KEY_AUTO_REQUEST_DESKTOP_SCREEN, false))
    val autoRequestDesktopScreen: StateFlow<Boolean> = _autoRequestDesktopScreen.asStateFlow()

    private val _showBottomNavLabels = MutableStateFlow(readBoolean(KEY_SHOW_BOTTOM_NAV_LABELS, true))
    val showBottomNavLabels: StateFlow<Boolean> = _showBottomNavLabels.asStateFlow()

    private val _confirmBeforeDelete = MutableStateFlow(readBoolean(KEY_CONFIRM_DELETE, true))
    val confirmBeforeDelete: StateFlow<Boolean> = _confirmBeforeDelete.asStateFlow()

    private val _migrationBackupLimitMb = MutableStateFlow(readMigrationBackupLimitMb())
    val migrationBackupLimitMb: StateFlow<Int> = _migrationBackupLimitMb.asStateFlow()

    var lastSessionId: String?
        get() = storage.getStringOrNull(KEY_LAST_SESSION)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_LAST_SESSION) else storage[KEY_LAST_SESSION] = value
        }

    var lastModelId: String?
        get() = storage.getStringOrNull(KEY_LAST_MODEL)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_LAST_MODEL) else storage[KEY_LAST_MODEL] = value
        }

    var remoteResumeSecret: String?
        get() = secretStore.get(KEY_REMOTE_RESUME)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) secretStore.remove(KEY_REMOTE_RESUME) else secretStore.put(KEY_REMOTE_RESUME, value)
        }

    var remotePairingId: String?
        get() = storage.getStringOrNull(KEY_REMOTE_PAIRING_ID)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_REMOTE_PAIRING_ID) else storage[KEY_REMOTE_PAIRING_ID] = value
        }

    var remoteRelayBaseUrl: String?
        get() = storage.getStringOrNull(KEY_REMOTE_RELAY_URL)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_REMOTE_RELAY_URL) else storage[KEY_REMOTE_RELAY_URL] = value
        }

    var remoteLanBaseUrl: String?
        get() = storage.getStringOrNull(KEY_REMOTE_LAN_URL)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_REMOTE_LAN_URL) else storage[KEY_REMOTE_LAN_URL] = value
        }

    var remoteLanCertificateFingerprint: String?
        get() = storage.getStringOrNull(KEY_REMOTE_LAN_FINGERPRINT)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_REMOTE_LAN_FINGERPRINT) else storage[KEY_REMOTE_LAN_FINGERPRINT] = value
        }

    var active567Group: String?
        get() = storage.getStringOrNull(KEY_ACTIVE_567_GROUP)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_ACTIVE_567_GROUP) else storage[KEY_ACTIVE_567_GROUP] = value
        }

    var activeImageGroup: String?
        get() = storage.getStringOrNull(KEY_ACTIVE_IMAGE_GROUP)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_ACTIVE_IMAGE_GROUP) else storage[KEY_ACTIVE_IMAGE_GROUP] = value
        }

    var activeImageModel: String?
        get() = storage.getStringOrNull(KEY_ACTIVE_IMAGE_MODEL)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_ACTIVE_IMAGE_MODEL) else storage[KEY_ACTIVE_IMAGE_MODEL] = value
        }

    var authToken: String?
        get() = secretStore.get(KEY_AUTH_TOKEN)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) secretStore.remove(KEY_AUTH_TOKEN) else secretStore.put(KEY_AUTH_TOKEN, value)
        }

    var authRefreshToken: String?
        get() = secretStore.get(KEY_AUTH_REFRESH_TOKEN)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) secretStore.remove(KEY_AUTH_REFRESH_TOKEN) else secretStore.put(KEY_AUTH_REFRESH_TOKEN, value)
        }

    var authUsername: String?
        get() = storage.getStringOrNull(KEY_AUTH_USERNAME)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_AUTH_USERNAME) else storage[KEY_AUTH_USERNAME] = value
        }

    var authQuotaUsd: Double
        get() = storage.getStringOrNull(KEY_AUTH_QUOTA_USD)?.toDoubleOrNull() ?: 0.0
        set(value) {
            storage[KEY_AUTH_QUOTA_USD] = value.toString()
        }

    var authUserId: Long
        get() = storage.getStringOrNull(KEY_AUTH_USER_ID)?.toLongOrNull() ?: 0L
        set(value) {
            storage[KEY_AUTH_USER_ID] = value.toString()
        }

    var authLoginType: String?
        get() = storage.getStringOrNull(KEY_AUTH_LOGIN_TYPE)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_AUTH_LOGIN_TYPE) else storage[KEY_AUTH_LOGIN_TYPE] = value
        }

    var authAccount: String?
        get() = storage.getStringOrNull(KEY_AUTH_ACCOUNT)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) storage.remove(KEY_AUTH_ACCOUNT) else storage[KEY_AUTH_ACCOUNT] = value
        }

    var authPassword: String?
        get() = secretStore.get(KEY_AUTH_PASSWORD)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) secretStore.remove(KEY_AUTH_PASSWORD) else secretStore.put(KEY_AUTH_PASSWORD, value)
        }

    fun getCachedGroupModels(group: String?): List<String> {
        val key = KEY_CACHE_GROUP_MODELS_PREFIX + (group ?: "default")
        val raw = storage.getStringOrNull(key)?.takeIf { it.isNotBlank() } ?: return emptyList()
        return raw.split(",").map { it.trim() }.filter { it.isNotEmpty() }
    }

    private fun modelContextKey(group: String?, model: String, kind: String = "override", server: String = serverUrl.value): String = "567agent.model-context.v1." + JsonArray(listOf(
        JsonPrimitive(serviceIdentity(server)), group?.let(::JsonPrimitive) ?: JsonNull, JsonPrimitive(kind), JsonPrimitive(model),
    )).toString()

    fun getModelContextOverride(group: String?, model: String, server: String = serverUrl.value): Long? = validModelContext(storage.getStringOrNull(modelContextKey(group, model, server = server))?.toLongOrNull())

    fun setModelContextOverride(group: String?, model: String, capacity: Long?) {
        require(capacity == null || validModelContext(capacity) != null)
        val key = modelContextKey(group, model)
        if (capacity == null) storage.remove(key) else storage[key] = capacity.toString()
    }

    fun getModelInferenceApi(group: String?, model: String, server: String = serverUrl.value): org.agent567.android.core.chat.InferenceApi? =
        org.agent567.android.core.chat.InferenceApi.fromWire(storage.getStringOrNull(modelContextKey(group, model, "api", server)))

    fun setModelInferenceApi(group: String?, model: String, api: org.agent567.android.core.chat.InferenceApi?) {
        val key = modelContextKey(group, model, "api")
        if (api == null) storage.remove(key) else storage[key] = api.wireValue
    }

    internal fun getCachedModelContexts(group: String?, server: String): Map<String, CachedModelContext> = runCatching {
        Agent567Json.decodeFromString<Map<String, CachedModelContext>>(storage.getString(modelContextKey(group, "", "metadata", server), "{}"))
    }.getOrDefault(emptyMap()).filterValues { it.isFresh(System.currentTimeMillis()) }

    fun setCachedModelContexts(group: String?, metadata: Map<String, ModelContextMetadata>, server: String = serverUrl.value) {
        val now = System.currentTimeMillis()
        val merged = getCachedModelContexts(group, server) + metadata.mapValues { CachedModelContext(it.value, now) }
        storage[modelContextKey(group, "", "metadata", server)] = Agent567Json.encodeToString(merged)
    }

    fun setCachedGroupModels(group: String?, models: List<String>) {
        val key = KEY_CACHE_GROUP_MODELS_PREFIX + (group ?: "default")
        if (models.isEmpty()) {
            storage.remove(key)
        } else {
            storage[key] = models.joinToString(",")
        }
    }

    fun getCachedGroupKey(group: String?, namespace: String = "legacy"): String? {
        val key = KEY_CACHE_GROUP_KEY_PREFIX + namespace + "." + (group ?: "default")
        return secretStore.get(key)?.takeIf { it.isNotBlank() }
    }

    fun setCachedGroupKey(group: String?, apiKey: String?, namespace: String = "legacy") {
        val key = KEY_CACHE_GROUP_KEY_PREFIX + namespace + "." + (group ?: "default")
        if (apiKey.isNullOrBlank()) {
            secretStore.remove(key)
        } else {
            secretStore.put(key, apiKey)
        }
    }

    fun clearAuthSnapshot() {
        authToken = null
        authRefreshToken = null
        authUsername = null
        authLoginType = null
        authAccount = null
        authPassword = null
        storage.remove(KEY_AUTH_QUOTA_USD)
        storage.remove(KEY_AUTH_USER_ID)
    }

    var imageGenEnabled: Boolean
        get() = storage.getBoolean(KEY_IMAGE_GEN_ENABLED, defaultValue = true)
        set(value) {
            storage.putBoolean(KEY_IMAGE_GEN_ENABLED, value)
        }

    fun setServerUrl(url: String) {
        val normalized = url.trim().trimEnd('/')
        require(normalized.isNotBlank()) { "serverUrl blank" }
        storage[KEY_SERVER_USER_SELECTED] = true
        storage[KEY_SERVER_URL] = normalized
        _serverUrl.value = normalized
    }

    fun setThemeMode(mode: ThemeMode) {
        storage[KEY_THEME] = mode.name
        _themeMode.value = mode
    }

    fun setAutoResumeLastSession(enabled: Boolean) {
        storage[KEY_AUTO_RESUME] = enabled
        _autoResumeLastSession.value = enabled
    }

    fun setMotionEnabled(enabled: Boolean) {
        storage[KEY_MOTION_ENABLED] = enabled
        _motionEnabled.value = enabled
    }

    fun setInputPredictionEnabled(enabled: Boolean) {
        storage[KEY_INPUT_PREDICTION_ENABLED] = enabled
        _inputPredictionEnabled.value = enabled
    }

    fun setAutoRequestDesktopScreen(enabled: Boolean) {
        storage[KEY_AUTO_REQUEST_DESKTOP_SCREEN] = enabled
        _autoRequestDesktopScreen.value = enabled
    }

    fun setShowBottomNavLabels(enabled: Boolean) {
        storage[KEY_SHOW_BOTTOM_NAV_LABELS] = enabled
        _showBottomNavLabels.value = enabled
    }

    fun setConfirmBeforeDelete(enabled: Boolean) {
        storage[KEY_CONFIRM_DELETE] = enabled
        _confirmBeforeDelete.value = enabled
    }

    fun setMigrationBackupLimitMb(limitMb: Int) {
        require(limitMb in MIGRATION_BACKUP_LIMIT_OPTIONS_MB)
        storage[KEY_MIGRATION_BACKUP_LIMIT_MB] = limitMb.toString()
        _migrationBackupLimitMb.value = limitMb
    }

    private fun readBoolean(key: String, default: Boolean): Boolean =
        runCatching { storage.getBooleanOrNull(key) }.getOrNull()
            ?: runCatching { storage.getStringOrNull(key)?.toBooleanStrictOrNull() }.getOrNull()
            ?: default

    private fun readServerUrl(): String {
        storage.getStringOrNull(KEY_SERVER_URL)?.takeIf { it.isNotBlank() }?.let { saved ->
            // Only the old canonical startup default lacked all choice records.
            // Preserve legacy/manual and ambiguous records, including custom URLs.
            if (saved == ServiceRoute.Mainland.origin && !legacyServerWasSaved &&
                !storage.hasKey(KEY_SERVER_USER_SELECTED) && !storage.hasKey("567agent.service-routes.known.v1")) {
                storage[KEY_SERVER_URL] = DEFAULT_SERVER_URL
                return DEFAULT_SERVER_URL
            }
            return saved
        }
        // Use the bootstrap until another ingress is explicitly selected.
        val server = DEFAULT_SERVER_URL
        storage[KEY_SERVER_URL] = server
        return server
    }

    private fun readMigrationBackupLimitMb(): Int =
        storage.getStringOrNull(KEY_MIGRATION_BACKUP_LIMIT_MB)?.toIntOrNull()
            ?.takeIf { it in MIGRATION_BACKUP_LIMIT_OPTIONS_MB }
            ?: MIGRATION_BACKUP_LIMIT_OPTIONS_MB.first()

    companion object {
        const val DOWNLOAD_SOURCE_GITHUB = "github"
        const val DOWNLOAD_SOURCE_GH_PROXY = "gh-proxy"
        const val DOWNLOAD_SOURCE_CUSTOM = "custom"

        private const val KEY_DOWNLOAD_SOURCE = "567agent.prefs.github_download_source"
        private const val KEY_DOWNLOAD_CUSTOM_PREFIX = "567agent.prefs.github_download_custom_prefix"

        /** 与桌面首次安装和节点发现入口一致；已有选择仍由持久化配置恢复。 */
        const val DEFAULT_SERVER_URL = "https://api.567.wiki"

        private const val KEY_SERVER_URL = "agent567.prefs.server_url"
        private const val KEY_SERVER_USER_SELECTED = "agent567.prefs.server_url_selected"
        private const val KEY_THEME = "agent567.prefs.theme"
        private const val KEY_AUTO_RESUME = "agent567.prefs.auto_resume"
        private const val KEY_MOTION_ENABLED = "agent567.prefs.motion_enabled"
        private const val KEY_INPUT_PREDICTION_ENABLED = "agent567.prefs.input_prediction_enabled"
        private const val KEY_AUTO_REQUEST_DESKTOP_SCREEN = "567agent.prefs.auto_request_desktop_screen"
        private const val KEY_SHOW_BOTTOM_NAV_LABELS = "567agent.prefs.show_bottom_nav_labels"
        private const val KEY_CONFIRM_DELETE = "agent567.prefs.confirm_delete"
        private const val KEY_MIGRATION_BACKUP_LIMIT_MB = "agent567.prefs.migration_backup_limit_mb"
        private const val KEY_LAST_SESSION = "agent567.prefs.last_session"
        private const val KEY_LAST_MODEL = "agent567.prefs.last_model"
        private const val KEY_REMOTE_RESUME = "agent567.prefs.remote_resume"
        private const val KEY_REMOTE_PAIRING_ID = "agent567.prefs.remote_pairing_id"
        private const val KEY_REMOTE_RELAY_URL = "agent567.prefs.remote_relay_url"
        private const val KEY_REMOTE_LAN_URL = "agent567.prefs.remote_lan_url"
        private const val KEY_REMOTE_LAN_FINGERPRINT = "agent567.prefs.remote_lan_fingerprint"
        private const val KEY_ACTIVE_567_GROUP = "agent567.prefs.active_567_group"
        private const val KEY_ACTIVE_IMAGE_GROUP = "agent567.prefs.active_image_group"
        private const val KEY_ACTIVE_IMAGE_MODEL = "agent567.prefs.active_image_model"
        private const val KEY_IMAGE_GEN_ENABLED = "agent567.prefs.image_gen_enabled"
        private const val KEY_AUTH_TOKEN = "agent567.prefs.auth_token"
        private const val KEY_AUTH_REFRESH_TOKEN = "agent567.prefs.auth_refresh_token"
        private const val KEY_AUTH_USERNAME = "agent567.prefs.auth_username"
        private const val KEY_AUTH_QUOTA_USD = "agent567.prefs.auth_quota_usd"
        private const val KEY_AUTH_USER_ID = "agent567.prefs.auth_user_id"
        private const val KEY_AUTH_LOGIN_TYPE = "agent567.prefs.auth_login_type"
        private const val KEY_AUTH_ACCOUNT = "agent567.prefs.auth_account"
        private const val KEY_AUTH_PASSWORD = "agent567.prefs.auth_password"
        private const val KEY_CACHE_GROUP_MODELS_PREFIX = "agent567.cache.models."
        private const val KEY_CACHE_GROUP_KEY_PREFIX = "agent567.cache.key."
    }
}

/** Normalize a user supplied HTTPS URL prefix or return null when it is invalid. */
fun normalizeGitHubDownloadPrefix(value: String?): String? {
    val trimmed = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    if ('?' in trimmed || '#' in trimmed) return null
    return runCatching {
        val url = Url(trimmed)
        require(url.protocol.name == "https")
        require(url.host.isNotBlank())
        require(url.user == null && url.password == null)
        val withoutTrailingSlashes = trimmed.trimEnd('/')
        "$withoutTrailingSlashes/"
    }.getOrNull()
}
