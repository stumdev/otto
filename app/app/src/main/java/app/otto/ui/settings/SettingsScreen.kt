package app.otto.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDefaults
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.otto.BuildConfig
import app.otto.data.Money
import app.otto.ui.components.CircleIconButton
import app.otto.ui.components.ScreenPadding
import app.otto.ui.components.SecondaryButton
import app.otto.ui.components.OttoCard
import app.otto.ui.components.OttoIcons
import app.otto.ui.components.OttoTextField
import app.otto.ui.components.ToggleRow
import app.otto.ui.components.TransientMessage
import app.otto.ui.components.ValueRow
import app.otto.ui.theme.OttoColors
import app.otto.ui.theme.OttoType

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit, onEditServer: () -> Unit, onDisconnected: () -> Unit, vm: SettingsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var toast by remember { mutableStateOf<String?>(null) }
    var editThreshold by remember { mutableStateOf(false) }
    var editTime by remember { mutableStateOf(false) }
    var confirmDisconnect by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.messages.collect { toast = it } }
    // ao voltar da tela do sistema "Acesso a notificações", atualiza o status
    LifecycleResumeEffect(Unit) {
        vm.refreshInstantAlerts()
        onPauseOrDispose { }
    }

    Box(Modifier.fillMaxSize().background(OttoColors.Bg)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                CircleIconButton(OttoIcons.ArrowLeft, "Voltar", onClick = onBack)
                Spacer(Modifier.width(12.dp))
                Text("Ajustes", style = OttoType.ScreenTitle, color = OttoColors.Text, modifier = Modifier.semantics { heading() })
            }
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .navigationBarsPadding()
                    .padding(horizontal = ScreenPadding, vertical = 8.dp),
            ) {
                Section("Servidor") {
                    ValueRow("Endereço", state.serverUrl.removePrefix("https://"), onClick = onEditServer)
                    Divider()
                    ValueRow("Token", state.tokenHint, onClick = onEditServer)
                }

                Section("Alertas instantâneos") {
                    InstantAlertsContent(state, vm, onMessage = { toast = it })
                }

                Section("Notificações") {
                    val s = state.settings
                    if (s == null) {
                        Text(state.error ?: "Carregando…", style = OttoType.Caption, color = OttoColors.Text2, modifier = Modifier.padding(vertical = 12.dp))
                    } else {
                        ValueRow(
                            "Alerta de saída grande",
                            if (s.bigOutflowThresholdCents == 0L) "Desligado" else "≥ ${Money.brl(s.bigOutflowThresholdCents)}",
                            onClick = { editThreshold = true },
                        )
                        Divider()
                        ToggleRow("Resumo diário", "Entrou, saiu e saldo do dia", s.dailySummaryEnabled, vm::setSummaryEnabled)
                        if (s.dailySummaryEnabled) {
                            Divider()
                            ValueRow("Horário do resumo", s.dailySummaryTime, onClick = { editTime = true })
                        }
                        Divider()
                        ToggleRow("Avisar entradas", null, s.notifyIncoming, vm::setNotifyIncoming)
                        Divider()
                        ToggleRow("Avisar saídas", null, s.notifyOutgoing, vm::setNotifyOutgoing)
                    }
                    Divider()
                    Text(
                        when {
                            state.pushActive -> "Entrega: push (Firebase Cloud Messaging)"
                            !state.fcmInApp -> "Entrega: notificação local (o app consulta o servidor). Para push instantâneo, configure o Firebase — veja o README."
                            else -> "Entrega: notificação local. O servidor ainda não tem o Firebase configurado."
                        },
                        style = OttoType.Caption,
                        color = OttoColors.Text2,
                        modifier = Modifier.padding(vertical = 12.dp),
                    )
                    SecondaryButton("Testar notificação", onClick = vm::testNotification, icon = OttoIcons.Bell)
                    Spacer(Modifier.height(8.dp))
                }

                Section("Segurança") {
                    ToggleRow("Bloqueio por biometria", "Pede digital, rosto ou PIN ao abrir", state.biometric, vm::setBiometric)
                    Divider()
                    ToggleRow("Proteger a tela", "Impede capturas e esconde a prévia em Recentes", state.secureScreen, vm::setSecureScreen)
                }

                Section("Privacidade") {
                    ValueRow("Apagar histórico do chat", "", onClick = vm::clearChat)
                    Divider()
                    ValueRow("Desconectar deste servidor", "", onClick = { confirmDisconnect = true })
                }

                state.status?.let { st ->
                    Spacer(Modifier.height(8.dp))
                    Text(
                        buildString {
                            append("Otto ${BuildConfig.VERSION_NAME} · servidor ${st.version}")
                            append(if (st.mode == "mock") " · dados fictícios (mock)" else " · dados reais")
                            append(if (st.ai == "ai") " · IA: ${st.aiProviders.joinToString(" → ")}" else " · IA offline (regras)")
                        },
                        style = OttoType.Small,
                        color = OttoColors.Text2,
                    )
                }
                Spacer(Modifier.height(32.dp))
            }
        }

        TransientMessage(
            toast,
            onDismiss = { toast = null },
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(horizontal = ScreenPadding, vertical = 12.dp),
        )
    }

    if (editThreshold) {
        ThresholdDialog(
            initialCents = state.settings?.bigOutflowThresholdCents ?: 100_000,
            onDismiss = { editThreshold = false },
            onSave = { input -> vm.saveThreshold(input).also { ok -> if (ok) editThreshold = false } },
        )
    }
    if (editTime) {
        val (h, m) = (state.settings?.dailySummaryTime ?: "22:00").split(":").map { it.toIntOrNull() ?: 0 }
        val tp = rememberTimePickerState(initialHour = h, initialMinute = m, is24Hour = true)
        AlertDialog(
            onDismissRequest = { editTime = false },
            containerColor = OttoColors.Elevated,
            title = { Text("Horário do resumo", style = OttoType.Title, color = OttoColors.Text) },
            text = {
                TimePicker(
                    state = tp,
                    colors = TimePickerDefaults.colors(
                        clockDialColor = OttoColors.Surface,
                        clockDialSelectedContentColor = OttoColors.OnPrimary,
                        clockDialUnselectedContentColor = OttoColors.Text,
                        selectorColor = OttoColors.Text,
                        containerColor = OttoColors.Elevated,
                        timeSelectorSelectedContainerColor = OttoColors.Text,
                        timeSelectorUnselectedContainerColor = OttoColors.Surface,
                        timeSelectorSelectedContentColor = OttoColors.OnPrimary,
                        timeSelectorUnselectedContentColor = OttoColors.Text,
                    ),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    vm.saveSummaryTime(tp.hour, tp.minute)
                    editTime = false
                }) { Text("Salvar", color = OttoColors.Text) }
            },
            dismissButton = { TextButton(onClick = { editTime = false }) { Text("Cancelar", color = OttoColors.Text2) } },
        )
    }
    if (confirmDisconnect) {
        AlertDialog(
            onDismissRequest = { confirmDisconnect = false },
            containerColor = OttoColors.Elevated,
            title = { Text("Desconectar?", style = OttoType.Title, color = OttoColors.Text) },
            text = { Text("O endereço, o token e o histórico do chat serão apagados deste aparelho.", style = OttoType.Body, color = OttoColors.Text3) },
            confirmButton = {
                TextButton(onClick = {
                    confirmDisconnect = false
                    vm.disconnect()
                    onDisconnected()
                }) { Text("Desconectar", color = OttoColors.Text) }
            },
            dismissButton = { TextButton(onClick = { confirmDisconnect = false }) { Text("Cancelar", color = OttoColors.Text2) } },
        )
    }
}

@Composable
private fun ThresholdDialog(initialCents: Long, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var value by remember { mutableStateOf(Money.plain(initialCents)) }
    var invalid by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = OttoColors.Elevated,
        title = { Text("Alerta de saída grande", style = OttoType.Title, color = OttoColors.Text) },
        text = {
            Column {
                Text("Avisar com destaque quando sair este valor ou mais. Use 0 para desligar.", style = OttoType.Caption, color = OttoColors.Text2)
                Spacer(Modifier.height(16.dp))
                OttoTextField(
                    value = value,
                    onValueChange = {
                        value = it
                        invalid = false
                    },
                    label = "Valor em reais",
                    placeholder = "1.000,00",
                    keyboardType = KeyboardType.Decimal,
                    imeAction = ImeAction.Done,
                    onDone = { onSave(value).also { invalid = Money.parseReais(value) == null } },
                )
                if (invalid) {
                    Spacer(Modifier.height(8.dp))
                    Text("Valor inválido. Ex.: 1.500,00", style = OttoType.Caption, color = OttoColors.Text)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                invalid = Money.parseReais(value) == null
                onSave(value)
            }) { Text("Salvar", color = OttoColors.Text) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar", color = OttoColors.Text2) } },
    )
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Text(
        title,
        style = OttoType.Caption,
        color = OttoColors.Text2,
        modifier = Modifier.padding(start = 4.dp, top = 20.dp, bottom = 8.dp).semantics { heading() },
    )
    OttoCard(Modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 4.dp), content = content)
}

@Composable
private fun Divider() {
    HorizontalDivider(color = OttoColors.Border, thickness = 1.dp)
}
