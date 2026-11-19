package app.tony.ui.chat

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tony.data.ChatCard
import app.tony.data.ChatStore
import app.tony.data.ChatStreamEvent
import app.tony.data.ChatTurnDto
import app.tony.data.Dates
import app.tony.data.StoredMessage
import app.tony.data.TonyRepository
import app.tony.data.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class UiMessage(
    val id: Long,
    val fromUser: Boolean,
    val text: String,
    val cards: List<ChatCard> = emptyList(),
    val offline: Boolean = false,
    val error: Boolean = false,
    val streaming: Boolean = false,
)

data class ChatState(
    val messages: List<UiMessage> = emptyList(),
    val typing: Boolean = false,
    val sending: Boolean = false,
    val syncLabel: String = "—",
    val loaded: Boolean = false,
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val repo: TonyRepository,
    private val store: ChatStore,
    private val savedState: SavedStateHandle,
) : ViewModel() {

    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state.asStateFlow()

    private var job: Job? = null
    private var nextId = System.currentTimeMillis()

    init {
        viewModelScope.launch {
            val history = store.load().map {
                UiMessage(it.id, it.role == "user", it.text, it.cards, it.offline, it.error)
            }
            _state.update { it.copy(messages = history, loaded = true) }
            nextId = maxOf(nextId, (history.maxOfOrNull { it.id } ?: 0) + 1)
            // pergunta vinda da tela Início (enviada uma única vez)
            val q = savedState.get<String>("q")?.trim().orEmpty()
            if (q.isNotEmpty() && savedState.get<Boolean>("q_sent") != true) {
                savedState["q_sent"] = true
                send(q)
            }
        }
        viewModelScope.launch {
            runCatching { repo.status() }.onSuccess { s ->
                _state.update { it.copy(syncLabel = "Sincronizado ${Dates.relative(s.lastSyncAt)}") }
            }
        }
    }

    fun send(text: String) {
        val question = text.trim()
        if (question.isEmpty() || _state.value.sending) return
        val userMsg = UiMessage(nextId++, fromUser = true, text = question)
        val answerId = nextId++
        val history = _state.value.messages.filter { !it.error && it.text.isNotBlank() }
        val turns = (history + userMsg).takeLast(12).map {
            ChatTurnDto(if (it.fromUser) "user" else "assistant", it.text)
        }
        _state.update {
            it.copy(
                messages = it.messages + userMsg + UiMessage(answerId, fromUser = false, text = "", streaming = true),
                typing = true,
                sending = true,
            )
        }

        job = viewModelScope.launch {
            try {
                repo.chat(turns).collect { ev ->
                    when (ev) {
                        is ChatStreamEvent.Meta -> edit(answerId) { it.copy(offline = ev.meta.mode == "offline") }
                        is ChatStreamEvent.Delta -> {
                            _state.update { it.copy(typing = false) }
                            edit(answerId) { it.copy(text = it.text + ev.text) }
                        }
                        is ChatStreamEvent.Card -> edit(answerId) { it.copy(cards = it.cards + ev.card) }
                        is ChatStreamEvent.Error -> edit(answerId) {
                            it.copy(text = if (it.text.isBlank()) ev.message else it.text + "\n\n" + ev.message, error = it.text.isBlank())
                        }
                        ChatStreamEvent.Done -> Unit
                    }
                }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                edit(answerId) { it.copy(text = e.userMessage(), error = true) }
            } finally {
                edit(answerId) {
                    if (it.text.isBlank() && it.cards.isEmpty()) it.copy(text = "Não consegui responder agora.", error = true, streaming = false)
                    else it.copy(streaming = false)
                }
                _state.update { it.copy(typing = false, sending = false) }
                persist()
            }
        }
    }

    fun clearHistory() {
        job?.cancel()
        viewModelScope.launch {
            store.clear()
            _state.update { it.copy(messages = emptyList(), typing = false, sending = false) }
        }
    }

    private fun edit(id: Long, f: (UiMessage) -> UiMessage) {
        _state.update { s -> s.copy(messages = s.messages.map { if (it.id == id) f(it) else it }) }
    }

    private fun persist() {
        val snapshot = _state.value.messages.filter { !it.streaming }
        viewModelScope.launch {
            store.save(
                snapshot.map {
                    StoredMessage(it.id, if (it.fromUser) "user" else "assistant", it.text, it.cards, it.offline, it.error)
                },
            )
        }
    }
}
