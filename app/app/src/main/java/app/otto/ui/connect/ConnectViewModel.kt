package app.otto.ui.connect

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.otto.data.OttoRepository
import app.otto.data.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface ConnectPhase {
    /** Verificando se a conta já tem banco conectado. */
    data object Checking : ConnectPhase
    data object Intro : ConnectPhase

    /** Widget Pluggy Connect aberto numa WebView. */
    data class Widget(val url: String) : ConnectPhase
    data object Importing : ConnectPhase
    data object Done : ConnectPhase
}

data class ConnectState(
    val phase: ConnectPhase = ConnectPhase.Checking,
    val busy: Boolean = false,
    val error: String? = null,
    /** Servidor em modo demonstração: não há widget, o botão cria uma conta de exemplo. */
    val demo: Boolean = false,
)

@HiltViewModel
class ConnectViewModel @Inject constructor(private val repo: OttoRepository) : ViewModel() {

    private val _state = MutableStateFlow(ConnectState())
    val state: StateFlow<ConnectState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            runCatching { repo.connection() }
                .onSuccess { c ->
                    _state.update {
                        if (c.connected) it.copy(phase = ConnectPhase.Done) else it.copy(phase = ConnectPhase.Intro, demo = c.mode == "mock")
                    }
                }
                .onFailure { e -> _state.update { it.copy(phase = ConnectPhase.Intro, error = e.userMessage()) } }
        }
    }

    /** Botão "Conectar Nubank". */
    fun start() {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            runCatching { repo.connectToken() }
                .onSuccess { t ->
                    val token = t.connectToken
                    if (t.mock || token == null) {
                        _state.update { it.copy(busy = false, demo = true) }
                        register(null)
                    } else {
                        _state.update { it.copy(busy = false, phase = ConnectPhase.Widget(repo.connectPageUrl(token))) }
                    }
                }
                .onFailure { e -> _state.update { it.copy(busy = false, error = e.userMessage()) } }
        }
    }

    /** O widget terminou: registra o item no servidor e espera a primeira importação. */
    fun onWidgetConnected(itemId: String) = register(itemId)

    fun signOut() {
        viewModelScope.launch { repo.signOut() }
    }

    fun onWidgetClosed() = _state.update { if (it.phase is ConnectPhase.Widget) it.copy(phase = ConnectPhase.Intro) else it }

    fun onWidgetError(message: String) = _state.update { it.copy(phase = ConnectPhase.Intro, error = message) }

    private fun register(itemId: String?) {
        viewModelScope.launch {
            _state.update { it.copy(phase = ConnectPhase.Importing, error = null) }
            runCatching { repo.connectItem(itemId) }
                .onSuccess { _state.update { it.copy(phase = ConnectPhase.Done) } }
                .onFailure { e -> _state.update { it.copy(phase = ConnectPhase.Intro, error = e.userMessage()) } }
        }
    }
}
