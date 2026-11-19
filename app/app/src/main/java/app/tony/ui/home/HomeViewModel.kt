package app.tony.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tony.data.Summary
import app.tony.data.TonyRepository
import app.tony.data.userMessage
import app.tony.notify.PushManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeState(
    val summary: Summary? = null,
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repo: TonyRepository,
    private val push: PushManager,
) : ViewModel() {

    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = it.summary == null, error = null) }
            runCatching { repo.summary() }
                .onSuccess { s -> _state.update { it.copy(summary = s, loading = false, error = null) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.userMessage()) } }
        }
    }

    /** Pull-to-refresh: pede ao servidor para sincronizar (só leitura no agregador) e recarrega. */
    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(refreshing = true) }
            runCatching { repo.sync() }
            runCatching { repo.summary() }
                .onSuccess { s -> _state.update { it.copy(summary = s, refreshing = false, error = null) } }
                .onFailure { e -> _state.update { it.copy(refreshing = false, error = if (it.summary == null) e.userMessage() else null) } }
                .onFailure { e -> _messages.tryEmit(e.userMessage()) }
            push.pollNow()
        }
    }

    /** Build debug: "Simular Pix" (pressão longa na marca). */
    fun simulatePix() {
        viewModelScope.launch {
            runCatching { repo.simulate() }
                .onSuccess { r ->
                    _messages.tryEmit(if (r.notified) "Pix simulado" else "Pix simulado (sem notificação)")
                    // sem FCM, a notificação chega pela outbox: buscamos na hora
                    push.pollNow()
                    load()
                }
                .onFailure { e -> _messages.tryEmit(e.userMessage()) }
        }
    }
}
