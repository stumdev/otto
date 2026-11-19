package app.otto.ui.settings

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
import app.otto.BuildConfig
import app.otto.bank.ListenerSettings
import app.otto.data.Dates
import app.otto.ui.components.SecondaryButton
import app.otto.ui.components.OttoIcons
import app.otto.ui.components.ValueRow
import app.otto.ui.theme.OttoColors
import app.otto.ui.theme.OttoType
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
                !state.bankAppInstalled -> "Não encontramos o app do Nubank neste celular. Ele é necessário para os avisos em segundos."
                state.listenerEnabled -> "Ligado. O Otto só lê as notificações do Nubank. A movimentação aparece como “a confirmar” até o Open Finance confirmar."
                else -> "Desligado. Ligue para ser avisado em segundos, em vez de esperar horas pelo Open Finance."
            },
            style = OttoType.Caption,
            color = OttoColors.Text2,
        )
        if (state.listenerEnabled && stats.recognized > 0) {
            Spacer(Modifier.height(6.dp))
            Text(
                "Reconhecidas: ${stats.recognized} · última ${Dates.relative(Instant.ofEpochMilli(stats.lastRecognizedAt).toString())}",
                style = OttoType.Small,
                color = OttoColors.Text2,
            )
        }
    }
    if (!state.listenerEnabled) {
        SecondaryButton("Ligar avisos em segundos", onClick = { ListenerSettings.openNotificationAccess(context) })
        Spacer(Modifier.height(8.dp))
        Text(
            "Se a opção aparecer bloqueada (Android 13+, app instalado fora da loja): abra as informações do app, toque em ⋮ e em “Permitir configurações restritas”. Depois volte e ative.",
            style = OttoType.Small,
            color = OttoColors.Text2,
        )
        Spacer(Modifier.height(8.dp))
        SecondaryButton("Abrir informações do app", onClick = { ListenerSettings.openAppInfo(context) })
        Spacer(Modifier.height(12.dp))
    } else {
        HorizontalDivider(color = OttoColors.Border, thickness = 1.dp)
        ValueRow("Desligar avisos em segundos", "", onClick = { ListenerSettings.openNotificationAccess(context) }, subtitle = "Abre a tela do Android onde o acesso é controlado", icon = OttoIcons.Zap)
    }
    HorizontalDivider(color = OttoColors.Border, thickness = 1.dp)
    ValueRow(
        "Notificações ignoradas",
        if (unrecognized.isEmpty()) "nenhuma" else unrecognized.size.toString(),
        onClick = { showDiag = true },
        subtitle = "Avisos do Nubank que o Otto não conseguiu entender",
        icon = OttoIcons.Shield,
    )
    if (BuildConfig.DEBUG) {
        HorizontalDivider(color = OttoColors.Border, thickness = 1.dp)
        ValueRow("Simular notificação do Nubank", "teste", onClick = vm::simulateBankNotification, icon = OttoIcons.Zap)
    }

    if (showDiag) {
        val clipboard = LocalClipboard.current
        val scope = rememberCoroutineScope()
        AlertDialog(
            onDismissRequest = { showDiag = false },
            containerColor = OttoColors.Elevated,
            title = { Text("Não reconhecidas", style = OttoType.Title, color = OttoColors.Text) },
            text = {
                Column {
                    Text(
                        if (unrecognized.isEmpty()) {
                            "Nenhuma notificação com valor ficou sem reconhecer."
                        } else {
                            "Notificações do Nubank com valor em R$ que o Otto ignorou (ex.: cartão de crédito, agendamentos). " +
                                "Se alguma era um Pix ou débito na conta, copie e envie para ajustar o leitor. Ficam só neste aparelho, cifradas."
                        },
                        style = OttoType.Caption,
                        color = OttoColors.Text2,
                    )
                    unrecognized.takeLast(5).reversed().forEach {
                        Spacer(Modifier.height(10.dp))
                        Text("${it.title} — ${it.text}", style = OttoType.Small, color = OttoColors.Text3)
                        Text(it.reason, style = OttoType.Small, color = OttoColors.Text2)
                    }
                }
            },
            confirmButton = {
                if (unrecognized.isNotEmpty()) {
                    TextButton(onClick = {
                        scope.launch {
                            clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Otto", vm.bankDiagnostics.exportText())))
                            onMessage("Copiado")
                        }
                    }) { Text("Copiar", color = OttoColors.Text) }
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    vm.clearBankDiagnostics()
                    showDiag = false
                }) { Text(if (unrecognized.isEmpty()) "Fechar" else "Apagar", color = OttoColors.Text2) }
            },
        )
    }
}
