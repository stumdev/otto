package app.otto.ui.transactions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.otto.data.OttoRepository
import app.otto.data.TxDto
import app.otto.data.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TxState(
    val items: List<TxDto> = emptyList(),
    val nextCursor: String? = null,
    val endReached: Boolean = false,
    val loading: Boolean = true,
    val loadingMore: Boolean = false,
    val refreshing: Boolean = false,
    val error: String? = null,
    val pageError: String? = null,
)

@HiltViewModel
class TransactionsViewModel @Inject constructor(private val repo: OttoRepository) : ViewModel() {

    private val _state = MutableStateFlow(TxState())
    val state: StateFlow<TxState> = _state.asStateFlow()
    private var job: Job? = null

    init {
        reload(initial = true)
    }

    fun reload(initial: Boolean = false) {
        job?.cancel()
        job = viewModelScope.launch {
            _state.update { if (initial) TxState(loading = true) else it.copy(refreshing = true, error = null) }
            runCatching { repo.transactions(cursor = null) }
                .onSuccess { p ->
                    _state.value = TxState(items = p.items, nextCursor = p.nextCursor, endReached = p.nextCursor == null, loading = false)
                }
                .onFailure { e ->
                    _state.update { it.copy(loading = false, refreshing = false, error = if (it.items.isEmpty()) e.userMessage() else null, pageError = if (it.items.isEmpty()) null else e.userMessage()) }
                }
        }
    }

    fun loadMore() {
        val s = _state.value
        if (s.loading || s.loadingMore || s.endReached || s.nextCursor == null) return
        job = viewModelScope.launch {
            _state.update { it.copy(loadingMore = true, pageError = null) }
            runCatching { repo.transactions(cursor = s.nextCursor) }
                .onSuccess { p ->
                    _state.update {
                        val known = it.items.mapTo(HashSet()) { tx -> tx.id }
                        it.copy(
                            items = it.items + p.items.filterNot { tx -> tx.id in known },
                            nextCursor = p.nextCursor,
                            endReached = p.nextCursor == null,
                            loadingMore = false,
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(loadingMore = false, pageError = e.userMessage()) } }
        }
    }
}
