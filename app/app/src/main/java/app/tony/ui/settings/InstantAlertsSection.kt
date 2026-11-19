package app.tony.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import android.content.ClipData
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import kotlinx.coroutines.launch
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tony.BuildConfig
import app.tony.bank.ListenerSettings
import app.tony.data.Dates
import app.tony.ui.components.SecondaryButton
import app.tony.ui.components.ValueRow
import app.tony.ui.theme.TonyColors
import app.tony.ui.theme.TonyType
import java.time.Instant

/** Conteúdo da seção "Alertas instantâneos" (leitura das notificações do Nubank). */
@Composable
fun InstantAlertsContent(state: SettingsState, vm: SettingsViewModel, onMessage: (String) -> Unit) {
    val context = LocalContext.current
    val unrecognized by vm.bankDiagnostics.unrecognized.collectAsStateWithLifecycle()
    val stats by vm.bankDiagnostics.stats.collectAsStateWithLifecycle()
    var showDiag by remember { mutableStateOf(false) }

    Column(Modifier.padding(vertical = 12.dp)) {
        Text(
            when {
                !state.bankAppInstalled -> "App do Nubank não encontrado neste celular. Os alertas instantâneos leem as notificações dele."
                state.listenerEnabled -> "Ativo. O Tony lê só as notificações do Nubank e avisa em segundos, com o saldo. A movimentação fica como “a confirmar” até chegar pelo Open Finance."
                else -> "Desligado. Ative para receber os avisos em segundos, em vez de esperar o Open Finance (que pode levar horas)."
            },
            style = TonyType.Caption,
            color = TonyColors.Text2,
        )
        if (state.listenerEnabled && stats.recognized > 0) {
            Spacer(Modifier.height(6.dp))
            Text(
                "Reconhecidas: ${stats.recognized} · última ${Dates.relative(Instant.ofEpochMilli(stats.lastRecognizedAt).toString())}",
                style = TonyType.Small,
                color = TonyColors.Text2,
            )
        }
    }
    if (!state.listenerEnabled) {
        SecondaryButton("Ativar acesso a notificações", onClick = { ListenerSettings.openNotificationAccess(context) })
        Spacer(Modifier.height(8.dp))
        Text(
            "Se a opção aparecer bloqueada (Android 13+, app instalado fora da loja): abra as informações do app, toque em ⋮ e em “Permitir configurações restritas”. Depois volte e ative.",
            style = TonyType.Small,
            color = TonyColors.Text2,
        )
        Spacer(Modifier.height(8.dp))
        SecondaryButton("Abrir informações do app", onClick = { ListenerSettings.openAppInfo(context) })
        Spacer(Modifier.height(12.dp))
    } else {
        HorizontalDivider(color = TonyColors.Border, thickness = 1.dp)
        ValueRow("Desativar", "", onClick = { ListenerSettings.openNotificationAccess(context) })
    }
    HorizontalDivider(color = TonyColors.Border, thickness = 1.dp)
    ValueRow(
        "Notificações não reconhecidas",
        if (unrecognized.isEmpty()) "nenhuma" else unrecognized.size.toString(),
        onClick = { showDiag = true },
    )
    if (BuildConfig.DEBUG) {
        HorizontalDivider(color = TonyColors.Border, thickness = 1.dp)
        ValueRow("Simular notificação do Nubank", "teste", onClick = vm::simulateBankNotification)
    }

    if (showDiag) {
        val clipboard = LocalClipboard.current
        val scope = rememberCoroutineScope()
        AlertDialog(
            onDismissRequest = { showDiag = false },
            containerColor = TonyColors.Elevated,
            title = { Text("Não reconhecidas", style = TonyType.Title, color = TonyColors.Text) },
            text = {
                Column {
                    Text(
                        if (unrecognized.isEmpty()) {
                            "Nenhuma notificação com valor ficou sem reconhecer."
                        } else {
                            "Notificações do Nubank com valor em R$ que o Tony ignorou (ex.: cartão de crédito, agendamentos). " +
                                "Se alguma era um Pix ou débito na conta, copie e envie para ajustar o leitor. Ficam só neste aparelho, cifradas."
                        },
                        style = TonyType.Caption,
                        color = TonyColors.Text2,
                    )
                    unrecognized.takeLast(5).reversed().forEach {
                        Spacer(Modifier.height(10.dp))
                        Text("${it.title} — ${it.text}", style = TonyType.Small, color = TonyColors.Text3)
                        Text(it.reason, style = TonyType.Small, color = TonyColors.Text2)
                    }
                }
            },
            confirmButton = {
                if (unrecognized.isNotEmpty()) {
                    TextButton(onClick = {
                        scope.launch {
                            clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Tony", vm.bankDiagnostics.exportText())))
                            onMessage("Copiado")
                        }
                    }) { Text("Copiar", color = TonyColors.Text) }
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    vm.clearBankDiagnostics()
                    showDiag = false
                }) { Text(if (unrecognized.isEmpty()) "Fechar" else "Apagar", color = TonyColors.Text2) }
            },
        )
    }
}
