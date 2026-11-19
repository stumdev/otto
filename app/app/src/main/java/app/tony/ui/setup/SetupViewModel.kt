package app.tony.ui.setup

import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tony.data.AppPrefs
import app.tony.data.Network
import app.tony.data.TonyRepository
import app.tony.data.userMessage
import app.tony.notify.PushManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SetupState(
    val url: String = "",
    val token: String = "",
    val connecting: Boolean = false,
    val error: String? = null,
    val done: Boolean = false,
)

@HiltViewModel
class SetupViewModel @Inject constructor(
    private val repo: TonyRepository,
    private val prefs: AppPrefs,
    private val push: PushManager,
) : ViewModel() {

    private val _state = MutableStateFlow(SetupState(url = prefs.config.value.serverUrl.orEmpty()))
    val state: StateFlow<SetupState> = _state.asStateFlow()

    fun setUrl(v: String) = _state.update { it.copy(url = v, error = null) }
    fun setToken(v: String) = _state.update { it.copy(token = v, error = null) }

    /** Conteúdo do QR gerado por `npm run setup-qr`: tony://setup?url=...&token=... */
    fun applyQr(raw: String) {
        val uri = runCatching { raw.toUri() }.getOrNull()
        val url = uri?.takeIf { it.scheme == "tony" && it.host == "setup" }?.getQueryParameter("url")
        val token = uri?.getQueryParameter("token")
        if (url.isNullOrBlank() || token.isNullOrBlank()) {
            _state.update { it.copy(error = "QR code não reconhecido.") }
            return
        }
        _state.update { it.copy(url = url, token = token, error = null) }
        connect()
    }

    fun connect() {
        val s = _state.value
        if (s.connecting) return
        val normalized = Network.normalizeBaseUrl(s.url)
        when {
            s.url.isBlank() -> return _state.update { it.copy(error = "Informe o endereço do servidor.") }
            normalized == null -> return _state.update { it.copy(error = "Endereço inválido. Use https:// (http só no build de teste).") }
            s.token.length < 32 -> return _state.update { it.copy(error = "O token tem pelo menos 32 caracteres.") }
        }
        viewModelScope.launch {
            _state.update { it.copy(connecting = true, error = null) }
            repo.probe(s.url, s.token)
                .onSuccess {
                    prefs.saveServer(normalized.toString().trimEnd('/'), s.token.trim())
                    push.ensureRegistered()
                    _state.update { it.copy(connecting = false, done = true, token = "") }
                }
                .onFailure { e ->
                    _state.update { it.copy(connecting = false, error = if (e is IllegalArgumentException) e.message else e.userMessage()) }
                }
        }
    }
}
