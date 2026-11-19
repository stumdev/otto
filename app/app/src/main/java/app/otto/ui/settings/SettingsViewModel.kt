package app.otto.ui.settings

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.otto.data.AppPrefs
import app.otto.data.ChatStore
import app.otto.data.Money
import app.otto.data.NotificationDto
import app.otto.data.ServerSettings
import app.otto.data.ServerStatus
import app.otto.data.SettingsPatch
import app.otto.data.OttoRepository
import app.otto.data.userMessage
import app.otto.notify.Notifications
import app.otto.notify.PushManager
import app.otto.bank.BankDiagnostics
import app.otto.bank.BankEventSender
import app.otto.bank.BankNotificationListener
import app.otto.bank.BankNotificationParser
import app.otto.bank.ParseResult
import app.otto.security.AppLock
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
    val listenerEnabled: Boolean = false,
    val bankAppInstalled: Boolean = true,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val repo: OttoRepository,
    private val prefs: AppPrefs,
    private val push: PushManager,
    private val lock: AppLock,
    private val chatStore: ChatStore,
    private val bankSender: BankEventSender,
    val bankDiagnostics: BankDiagnostics,
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
                        body = "Notificação local funcionando. Sem FCM, o Otto verifica o servidor periodicamente.",
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

    /** Chamado ao voltar das configurações do sistema. */
    fun refreshInstantAlerts() {
        _state.update {
            it.copy(
                listenerEnabled = BankNotificationListener.isEnabled(context),
                bankAppInstalled = BankNotificationListener.isBankAppInstalled(context),
            )
        }
    }

    fun clearBankDiagnostics() = bankDiagnostics.clear()

    /**
     * Build debug: passa um texto de exemplo pelo MESMO caminho de uma notificação real
     * (parser -> servidor -> aviso), para testar sem fazer um Pix.
     */
    fun simulateBankNotification() {
        val title = "Transferência recebida"
        val text = "Você recebeu uma transferência pelo Pix de R$ 25,00 de Teste da Silva."
        val r = BankNotificationParser.parse(title, text)
        if (r !is ParseResult.Parsed) {
            _messages.tryEmit("O leitor não reconheceu o exemplo")
            return
        }
        val now = System.currentTimeMillis()
        val fp = BankNotificationListener.fingerprint("simulacao", "sim-$now", now, title, text)
        viewModelScope.launch {
            if (bankSender.claim(fp)) bankSender.send(r.event, fp, now)
            _messages.tryEmit("Leitura simulada enviada")
        }
    }

    fun disconnect() {
        prefs.clearServer()
        viewModelScope.launch { chatStore.clear() }
    }
}
