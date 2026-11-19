package app.tony.ui.transactions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tony.data.Dates
import app.tony.ui.components.CircleIconButton
import app.tony.ui.components.MessageState
import app.tony.ui.components.ScreenPadding
import app.tony.ui.components.SecondaryButton
import app.tony.ui.components.Skeleton
import app.tony.ui.components.TonyIcons
import app.tony.ui.components.TxRow
import app.tony.ui.theme.TonyColors
import app.tony.ui.theme.TonyType

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransactionsScreen(onBack: () -> Unit, vm: TransactionsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()

    // carrega a próxima página perto do fim da lista
    val nearEnd by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= listState.layoutInfo.totalItemsCount - 6
        }
    }
    LaunchedEffect(nearEnd, state.items.size) { if (nearEnd) vm.loadMore() }

    Column(Modifier.fillMaxSize().background(TonyColors.Bg).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(TonyIcons.ArrowLeft, "Voltar", onClick = onBack)
            Spacer(Modifier.width(12.dp))
            Text("Movimentações", style = TonyType.ScreenTitle, color = TonyColors.Text, modifier = Modifier.semantics { heading() })
        }

        val pullState = rememberPullToRefreshState()
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = { vm.reload() },
            state = pullState,
            modifier = Modifier.fillMaxSize(),
            indicator = {
                PullToRefreshDefaults.Indicator(
                    state = pullState,
                    isRefreshing = state.refreshing,
                    modifier = Modifier.align(Alignment.TopCenter),
                    containerColor = TonyColors.Elevated,
                    color = TonyColors.Text,
                )
            },
        ) {
            when {
                state.loading -> ListSkeleton()
                state.error != null -> MessageState("Não deu para carregar", state.error, action = "Tentar de novo", onAction = { vm.reload(initial = true) })
                state.items.isEmpty() -> MessageState("Nenhuma movimentação", "Quando houver entradas ou saídas, elas aparecem aqui.")
                else -> {
                    val groups = remember(state.items) { state.items.groupBy { it.localDate } }
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize().navigationBarsPadding(),
                        contentPadding = PaddingValues(horizontal = ScreenPadding, vertical = 8.dp),
                    ) {
                        groups.forEach { (date, txs) ->
                            item(key = "h-$date") {
                                Text(
                                    Dates.dayHeader(date),
                                    style = TonyType.Caption,
                                    color = TonyColors.Text2,
                                    modifier = Modifier.padding(top = 20.dp, bottom = 6.dp).semantics { heading() },
                                )
                            }
                            txs.forEach { tx ->
                                item(key = "t-${tx.id}") {
                                    TxRow(tx.title, tx.subtitle, tx.amountCents, Modifier.padding(vertical = 6.dp))
                                }
                            }
                        }
                        item(key = "footer") {
                            Box(Modifier.fillMaxWidth().padding(vertical = 20.dp), contentAlignment = Alignment.Center) {
                                when {
                                    state.loadingMore -> CircularProgressIndicator(color = TonyColors.Text, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                                    state.pageError != null -> Box(Modifier.width(200.dp)) { SecondaryButton("Carregar mais", onClick = vm::loadMore) }
                                    state.endReached -> Text("Fim das movimentações", style = TonyType.Small, color = TonyColors.Text2)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ListSkeleton() {
    Column(Modifier.fillMaxSize().padding(horizontal = ScreenPadding, vertical = 16.dp)) {
        repeat(9) {
            Row(Modifier.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Skeleton(Modifier.size(40.dp), shape = RoundedCornerShape(50))
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Skeleton(Modifier.width(150.dp).height(14.dp))
                    Spacer(Modifier.height(6.dp))
                    Skeleton(Modifier.width(96.dp).height(11.dp))
                }
                Skeleton(Modifier.width(80.dp).height(14.dp))
            }
        }
    }
}
