package app.tony.ui.home

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tony.BuildConfig
import app.tony.data.Dates
import app.tony.data.Money
import app.tony.data.Summary
import app.tony.ui.components.AmountText
import app.tony.ui.components.AskField
import app.tony.ui.components.CircleIconButton
import app.tony.ui.components.MessageState
import app.tony.ui.components.ScreenPadding
import app.tony.ui.components.SectionHeader
import app.tony.ui.components.Skeleton
import app.tony.ui.components.Sparkline
import app.tony.ui.components.StatusLine
import app.tony.ui.components.TonyCard
import app.tony.ui.components.TonyIcons
import app.tony.ui.components.TonyMark
import app.tony.ui.components.TransientMessage
import app.tony.ui.components.TxRow
import app.tony.ui.components.rememberHaptic
import app.tony.ui.theme.TonyColors
import app.tony.ui.theme.TonyType
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenChat: (String?) -> Unit,
    onOpenTransactions: () -> Unit,
    onOpenSettings: () -> Unit,
    vm: HomeViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    var question by rememberSaveable { mutableStateOf("") }
    var toast by remember { mutableStateOf<String?>(null) }
    val haptic = rememberHaptic()

    RequestNotificationPermission()

    LaunchedEffect(Unit) { vm.messages.collect { toast = it } }
    // relógio do "Atualizado há X": recompõe a cada minuto e recarrega com o app aberto
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            tick++
            vm.load()
        }
    }

    Box(Modifier.fillMaxSize().background(TonyColors.Bg)) {
        val pullState = rememberPullToRefreshState()
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = vm::refresh,
            state = pullState,
            modifier = Modifier.fillMaxSize(),
            indicator = {
                PullToRefreshDefaults.Indicator(
                    state = pullState,
                    isRefreshing = state.refreshing,
                    modifier = Modifier.align(Alignment.TopCenter).padding(WindowInsets.statusBars.asPaddingValues()),
                    containerColor = TonyColors.Elevated,
                    color = TonyColors.Text,
                )
            },
        ) {
            val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = ScreenPadding, end = ScreenPadding, top = top + 12.dp, bottom = 140.dp),
            ) {
                item {
                    Header(
                        dateLabel = state.summary?.today?.label ?: Dates.shortLabel(Dates.today()),
                        onBell = onOpenSettings,
                        onLongPressMark = if (BuildConfig.DEBUG) vm::simulatePix else null,
                    )
                }
                val s = state.summary
                when {
                    s != null -> content(s, tick, onOpenTransactions)
                    state.loading -> item { HomeSkeleton() }
                    else -> item {
                        MessageState(
                            title = "Não deu para carregar",
                            body = state.error,
                            action = "Tentar de novo",
                            onAction = vm::load,
                        )
                    }
                }
            }
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(TonyColors.Bg)
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = ScreenPadding, vertical = 12.dp),
        ) {
            TransientMessage(toast, onDismiss = { toast = null })
            AskField(
                value = question,
                onValueChange = { question = it },
                onSend = {
                    haptic()
                    val q = question.trim()
                    question = ""
                    onOpenChat(q)
                },
            )
        }
    }
}

@Composable
private fun Header(dateLabel: String, onBell: () -> Unit, onLongPressMark: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().padding(bottom = 28.dp), verticalAlignment = Alignment.CenterVertically) {
        TonyMark(40.dp, onLongPress = onLongPressMark)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text("Tony", style = TonyType.Title, color = TonyColors.Text, modifier = Modifier.semantics { heading() })
            Text(dateLabel, style = TonyType.Caption, color = TonyColors.Text2)
        }
        CircleIconButton(TonyIcons.Bell, "Notificações e ajustes", onClick = onBell)
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.content(s: Summary, tick: Int, onOpenTransactions: () -> Unit) {
    item(key = "balance") {
        Column(Modifier.fillMaxWidth()) {
            Text("Saldo na conta", style = TonyType.Label, color = TonyColors.Text2)
            Spacer(Modifier.height(6.dp))
            val balance = Money.brl(s.balanceCents).let { if (s.balanceCents < 0) "${Money.MINUS} $it" else it }
            BasicText(
                text = balance,
                style = TonyType.Balance.copy(color = TonyColors.Text),
                maxLines = 1,
                autoSize = TextAutoSize.StepBased(minFontSize = 26.sp, maxFontSize = TonyType.Balance.fontSize),
                modifier = Modifier.semantics { contentDescription = "Saldo na conta: $balance" },
            )
            Spacer(Modifier.height(8.dp))
            // `tick` força a atualização do texto relativo a cada minuto
            val updated = remember(s.lastSyncAt, tick) { Dates.relative(s.lastSyncAt ?: s.balanceUpdatedAt) }
            StatusLine("Atualizado $updated")
        }
    }
    item(key = "cards") {
        Row(Modifier.fillMaxWidth().padding(top = 28.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TonyCard(Modifier.weight(1f)) {
                Text("Entrou hoje", style = TonyType.Caption, color = TonyColors.Text2)
                Spacer(Modifier.height(8.dp))
                AmountText(s.today.inCents, TonyType.CardValue)
            }
            TonyCard(Modifier.weight(1f)) {
                Text("Saiu hoje", style = TonyType.Caption, color = TonyColors.Text2)
                Spacer(Modifier.height(8.dp))
                AmountText(-s.today.outCents, TonyType.CardValue)
            }
        }
    }
    item(key = "chart") {
        TonyCard(Modifier.fillMaxWidth().padding(top = 12.dp)) {
            Text("Últimos 7 dias", style = TonyType.Caption, color = TonyColors.Text2)
            Spacer(Modifier.height(12.dp))
            Sparkline(
                values = s.series.map { it.closingBalanceCents },
                description = "Gráfico do saldo nos últimos 7 dias",
                modifier = Modifier.fillMaxWidth().height(72.dp),
            )
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                AmountText(s.week.netCents, TonyType.BodyMedium)
                Text(" na semana", style = TonyType.Body, color = TonyColors.Text2)
            }
        }
    }
    item(key = "tx-header") {
        SectionHeader("Movimentações", Modifier.padding(top = 28.dp, bottom = 4.dp), action = "Ver tudo", onAction = onOpenTransactions)
    }
    if (s.recent.isEmpty()) {
        item(key = "empty") { MessageState("Nenhuma movimentação ainda", "Elas aparecem aqui assim que chegarem.") }
    } else {
        items(s.recent, key = { "tx-${it.id}" }) { tx ->
            TxRow(tx.title, tx.subtitle, tx.amountCents, Modifier.clickable(onClick = onOpenTransactions).padding(vertical = 6.dp))
        }
    }
}

@Composable
private fun HomeSkeleton() {
    Column(Modifier.fillMaxWidth()) {
        Skeleton(Modifier.width(110.dp).height(14.dp))
        Spacer(Modifier.height(12.dp))
        Skeleton(Modifier.width(240.dp).height(46.dp))
        Spacer(Modifier.height(12.dp))
        Skeleton(Modifier.width(140.dp).height(12.dp))
        Spacer(Modifier.height(28.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Skeleton(Modifier.weight(1f).height(88.dp), shape = app.tony.ui.components.CardShape)
            Skeleton(Modifier.weight(1f).height(88.dp), shape = app.tony.ui.components.CardShape)
        }
        Spacer(Modifier.height(12.dp))
        Skeleton(Modifier.fillMaxWidth().height(150.dp), shape = app.tony.ui.components.CardShape)
        Spacer(Modifier.height(28.dp))
        repeat(3) {
            Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Skeleton(Modifier.size(40.dp), shape = androidx.compose.foundation.shape.RoundedCornerShape(50))
                Spacer(Modifier.width(14.dp))
                Column {
                    Skeleton(Modifier.width(140.dp).height(14.dp))
                    Spacer(Modifier.height(6.dp))
                    Skeleton(Modifier.width(90.dp).height(11.dp))
                }
            }
        }
    }
}

/** Android 13+: pede permissão de notificação uma vez. */
@Composable
private fun RequestNotificationPermission() {
    if (Build.VERSION.SDK_INT < 33) return
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
