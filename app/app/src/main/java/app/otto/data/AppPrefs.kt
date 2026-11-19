package app.otto.data

import android.content.Context
import androidx.core.content.edit
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

data class AppConfig(
    val serverUrl: String?,
    val token: String?,
    val biometricEnabled: Boolean,
    val secureScreen: Boolean,
) {
    val isConfigured: Boolean get() = !serverUrl.isNullOrBlank() && !token.isNullOrBlank()
}

/**
 * Preferências locais. O token é sempre gravado cifrado pelo [SecureStore];
 * o resto não é segredo. O arquivo fica fora do backup (veja data_extraction_rules.xml).
 */
@Singleton
class AppPrefs @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val secure: SecureStore,
) {
    private val sp = context.getSharedPreferences("otto_prefs", Context.MODE_PRIVATE)

    private val _config = MutableStateFlow(read())
    val config: StateFlow<AppConfig> = _config.asStateFlow()

    private fun read() = AppConfig(
        serverUrl = sp.getString(K_URL, null),
        token = sp.getString(K_TOKEN, null)?.let { secure.decryptString(it) },
        biometricEnabled = sp.getBoolean(K_BIOMETRIC, true),
        secureScreen = sp.getBoolean(K_SECURE, true),
    )

    fun saveServer(url: String, token: String) {
        sp.edit {
            putString(K_URL, url)
            putString(K_TOKEN, secure.encryptString(token))
            putBoolean(K_FID_SYNCED, false)
            putLong(K_LAST_NOTIFICATION, -1L)
            // ids da outbox são por servidor
            remove(K_SHOWN_IDS)
        }
        _config.value = read()
    }

    fun clearServer() {
        sp.edit {
            remove(K_URL)
            remove(K_TOKEN)
            putBoolean(K_FID_SYNCED, false)
        }
        _config.value = read()
    }

    fun setBiometric(enabled: Boolean) {
        sp.edit { putBoolean(K_BIOMETRIC, enabled) }
        _config.value = read()
    }

    fun setSecureScreen(enabled: Boolean) {
        sp.edit { putBoolean(K_SECURE, enabled) }
        _config.value = read()
    }

    /** Último id da outbox de notificações já exibido. -1 = ainda não sincronizado. */
    var lastNotificationId: Long
        get() = sp.getLong(K_LAST_NOTIFICATION, -1L)
        set(v) = sp.edit { putLong(K_LAST_NOTIFICATION, v) }

    /** Ids da outbox já exibidos (mais recentes no fim). Evita mostrar a mesma notificação duas vezes. */
    var shownNotificationIds: List<Long>
        get() = sp.getString(K_SHOWN_IDS, "").orEmpty().split(',').mapNotNull { it.toLongOrNull() }
        set(v) = sp.edit { putString(K_SHOWN_IDS, v.joinToString(",")) }

    /** Impressões digitais das últimas notificações do banco já processadas (evita reenvio). */
    var bankFingerprints: List<String>
        get() = sp.getString(K_BANK_FPS, "").orEmpty().split(',').filter { it.length == 64 }
        set(v) = sp.edit { putString(K_BANK_FPS, v.joinToString(",")) }

    /** Esconde o cartão "Ative alertas instantâneos" da tela Início. */
    var instantHintDismissed: Boolean
        get() = sp.getBoolean(K_INSTANT_HINT, false)
        set(v) = sp.edit { putBoolean(K_INSTANT_HINT, v) }

    /** Firebase Installation ID recebido em onRegistered(). */
    var fid: String?
        get() = sp.getString(K_FID, null)
        set(v) = sp.edit {
            putString(K_FID, v)
            putBoolean(K_FID_SYNCED, false)
        }

    var fidSynced: Boolean
        get() = sp.getBoolean(K_FID_SYNCED, false)
        set(v) = sp.edit { putBoolean(K_FID_SYNCED, v) }

    /** true quando o servidor confirmou que envia push FCM para este aparelho. */
    var pushActive: Boolean
        get() = sp.getBoolean(K_PUSH_ACTIVE, false)
        set(v) = sp.edit { putBoolean(K_PUSH_ACTIVE, v) }

    private companion object {
        const val K_URL = "server_url"
        const val K_TOKEN = "server_token_enc"
        const val K_BIOMETRIC = "biometric_enabled"
        const val K_SECURE = "secure_screen"
        const val K_LAST_NOTIFICATION = "last_notification_id"
        const val K_FID = "fcm_fid"
        const val K_FID_SYNCED = "fcm_fid_synced"
        const val K_PUSH_ACTIVE = "push_active"
        const val K_SHOWN_IDS = "shown_notification_ids"
        const val K_BANK_FPS = "bank_fingerprints"
        const val K_INSTANT_HINT = "instant_hint_dismissed"
    }
}
