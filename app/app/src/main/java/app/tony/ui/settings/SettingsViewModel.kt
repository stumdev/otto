package app.tony.ui.settings

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tony.data.AppPrefs
import app.tony.data.ChatStore
import app.tony.data.Money
import app.tony.data.NotificationDto
import app.tony.data.ServerSettings
import app.tony.data.ServerStatus
import app.tony.data.SettingsPatch
import app.tony.data.TonyRepository
import app.tony.data.userMessage
import app.tony.notify.Notifications
import app.tony.notify.PushManager
import app.tony.security.AppLock
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsState(
    val serverUrl: String = "",
    val tokenHint: String = "",
    val settings: ServerSettings? = null,
    val status: ServerStatus? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val biometric: Boolean = true,
    val secureScreen: Boolean = true,
    val pushActive: Boolean = false,
    val fcmInApp: Boolean = false,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val repo: TonyRepository,
    private val prefs: AppPrefs,
    private val push: PushManager,
    private val lock: AppLock,
    private val chatStore: ChatStore,
) : ViewModel() {

    private val _state = MutableStateFlow(SettingsState())
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    init {
        refreshLocal()
        load()
    }

    private fun refreshLocal() {
        val cfg = prefs.config.value
        _state.update {
            it.copy(
                serverUrl = cfg.serverUrl.orEmpty(),
                tokenHint = cfg.token?.let { t -> "••••" + t.takeLast(4) }.orEmpty(),
                biometric = cfg.biometricEnabled,
                secureScreen = cfg.secureScreen,
                pushActive = prefs.pushActive,
                fcmInApp = push.fcmAvailable,
            )
        }
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = it.settings == null, error = null) }
            push.syncFid()
            push.refreshPushState()
            val s = runCatching { repo.settings() }
            val st = runCatching { repo.status() }
            _state.update {
                it.copy(
                    settings = s.getOrNull() ?: it.settings,
                    status = st.getOrNull() ?: it.status,
                    loading = false,
                    error = s.exceptionOrNull()?.userMessage(),
                    pushActive = prefs.pushActive,
                )
            }
        }
    }

    private fun patch(p: SettingsPatch, ok: String = "Salvo") {
        viewModelScope.launch {
            runCatching { repo.updateSettings(p) }
                .onSuccess { s ->
                    _state.update { it.copy(settings = s) }
                    _messages.tryEmit(ok)
                }
                .onFailure { e -> _messages.tryEmit(e.userMessage()) }
        }
    }

    /** Retorna false se o valor digitado for inválido. */
    fun saveThreshold(input: String): Boolean {
        val cents = Money.parseReais(input) ?: return false
        patch(SettingsPatch(bigOutflowThresholdCents = cents), "Limite salvo: ${Money.brl(cents)}")
        return true
    }

    fun saveSummaryTime(hour: Int, minute: Int) {
        val hhmm = "%02d:%02d".format(hour, minute)
        patch(SettingsPatch(dailySummaryTime = hhmm), "Resumo diário às $hhmm")
    }

    fun setSummaryEnabled(v: Boolean) = patch(SettingsPatch(dailySummaryEnabled = v))
    fun setNotifyIncoming(v: Boolean) = patch(SettingsPatch(notifyIncoming = v))
    fun setNotifyOutgoing(v: Boolean) = patch(SettingsPatch(notifyOutgoing = v))

    fun testNotification() {
        viewModelScope.launch {
            if (prefs.pushActive) {
                runCatching { repo.testPush() }
                    .onSuccess { _messages.tryEmit("Enviada por push (FCM)") }
                    .onFailure { e -> _messages.tryEmit(e.userMessage()) }
            } else {
                Notifications.post(
                    context,
                    NotificationDto(
                        id = 999_999,
                        kind = "test",
                        title = "Notificação de teste",
                        body = "Notificação local funcionando. Sem FCM, o Tony verifica o servidor periodicamente.",
                        target = "settings",
                    ),
                )
                _messages.tryEmit("Notificação local enviada")
            }
        }
    }

    fun setBiometric(v: Boolean) {
        prefs.setBiometric(v)
        if (!v) lock.disable()
        refreshLocal()
    }

    fun setSecureScreen(v: Boolean) {
        prefs.setSecureScreen(v)
        refreshLocal()
    }

    fun clearChat() {
        viewModelScope.launch {
            chatStore.clear()
            _messages.tryEmit("Histórico do chat apagado")
        }
    }

    fun disconnect() {
        prefs.clearServer()
        viewModelScope.launch { chatStore.clear() }
    }
}
