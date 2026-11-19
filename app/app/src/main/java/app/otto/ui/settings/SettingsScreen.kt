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
import app.otto.ui.components.RowIcon
import app.otto.ui.components.ValueRow
import app.otto.ui.components.enterAnimation
import app.otto.ui.theme.OttoColors
import app.otto.ui.theme.OttoType

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit, onBankDisconnected: () -> Unit, vm: SettingsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var toast by remember { mutableStateOf<String?>(null) }
    var editThreshold by remember { mutableStateOf(false) }
    var editTime by remember { mutableStateOf(false) }
    var confirmSignOut by remember { mutableStateOf(false) }
    var confirmDisconnectBank by remember { mutableStateOf(false) }
    var deleteAccount by remember { mutableStateOf(false) }
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
                Section(
                    "Sua conta",
                    "Você está conectado com este e-mail.",
                    index = 0,
                ) {
                    InfoRow(OttoIcons.User, "E-mail", state.email)
                    Divider()
                    ValueRow(
                        "Sair da conta",
                        "",
                        onClick = { confirmSignOut = true },
                        subtitle = "Você entra de novo com e-mail e senha",
                        icon = OttoIcons.LogOut,
                    )
                }

                Section(
                    "Avisos em segundos",
                    "O Otto lê as notificações do app do Nubank neste celular e te avisa na hora, sem esperar o Open Finance.",
                    index = 1,
                ) {
                    InstantAlertsContent(state, vm, onMessage = { toast = it })
                }

                Section(
                    "Notificações",
                    "Escolha o que o Otto avisa e quando.",
                    index = 2,
                ) {
                    val s = state.settings
                    if (s == null) {
                        Text(state.error ?: "Carregando…", style = OttoType.Caption, color = OttoColors.Text2, modifier = Modifier.padding(vertical = 12.dp))
                    } else {
                        ToggleRow("Avisar entradas", "Uma notificação a cada dinheiro que entra", s.notifyIncoming, vm::setNotifyIncoming, icon = OttoIcons.Bell)
                        Divider()
                        ToggleRow("Avisar saídas", "Uma notificação a cada pagamento ou Pix enviado", s.notifyOutgoing, vm::setNotifyOutgoing, icon = OttoIcons.Bell)
                        Divider()
                        ValueRow(
                            "Alerta de saída grande",
                            "",
                            onClick = { editThreshold = true },
                            subtitle = if (s.bigOutflowThresholdCents == 0L) "Desligado" else "Destaca a notificação quando sair ${Money.brl(s.bigOutflowThresholdCents)} ou mais",
                            icon = OttoIcons.Zap,
                        )
                        Divider()
                        ToggleRow("Resumo do dia", "Uma notificação por dia com o que entrou, saiu e o saldo", s.dailySummaryEnabled, vm::setSummaryEnabled, icon = OttoIcons.Chat)
                        if (s.dailySummaryEnabled) {
                            Divider()
                            ValueRow("Horário do resumo", s.dailySummaryTime, onClick = { editTime = true }, subtitle = "Quando o resumo chega", icon = OttoIcons.Chat)
                        }
                    }
                    if (!state.pushActive) {
                        Divider()
                        Text(
                            "Os avisos chegam com o app aberto ou a cada poucos minutos. Para chegarem na hora com o app fechado, o servidor precisa do push ativado.",
                            style = OttoType.Small,
                            color = OttoColors.Text2,
                            modifier = Modifier.padding(vertical = 12.dp),
                        )
                    }
                }

                Section(
                    "Segurança",
                    "Proteja o que aparece na tela do Otto.",
                    index = 3,
                ) {
                    ToggleRow("Bloqueio ao abrir", "Pede digital, rosto ou PIN para abrir o app", state.biometric, vm::setBiometric, icon = OttoIcons.Lock)
                    Divider()
                    ToggleRow("Proteger a tela", "Bloqueia prints e esconde o app na lista de recentes", state.secureScreen, vm::setSecureScreen, icon = OttoIcons.Shield)
                }

                Section(
                    "Seus dados",
                    "Você decide o que fica guardado.",
                    index = 4,
                ) {
                    ValueRow(
                        "Apagar conversas do chat",
                        "",
                        onClick = vm::clearChat,
                        subtitle = "Remove o histórico guardado neste celular",
                        icon = OttoIcons.Chat,
                    )
                    Divider()
                    ValueRow(
                        "Desconectar o Nubank",
                        "",
                        onClick = { confirmDisconnectBank = true },
                        subtitle = "Apaga os dados importados e revoga a autorização",
                        icon = OttoIcons.Bank,
                    )
                    Divider()
                    ValueRow(
                        "Excluir minha conta",
                        "",
                        onClick = { deleteAccount = true },
                        subtitle = "Apaga a conta e tudo o que o Otto guarda sobre você",
                        icon = OttoIcons.Trash,
                    )
                }

                Spacer(Modifier.height(20.dp))
                Text(
                    "Otto ${BuildConfig.VERSION_NAME}",
                    style = OttoType.Small,
                    color = OttoColors.Text2,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
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
    if (confirmSignOut) {
        ConfirmDialog(
            title = "Sair da conta?",
            body = "Você precisará entrar de novo com e-mail e senha. O histórico do chat será apagado deste aparelho.",
            confirm = "Sair",
            onDismiss = { confirmSignOut = false },
            onConfirm = {
                confirmSignOut = false
                vm.signOut()
            },
        )
    }
    if (confirmDisconnectBank) {
        ConfirmDialog(
            title = "Desconectar o Nubank?",
            body = "Os dados importados serão apagados e a autorização do Open Finance será revogada. Sua conta do Otto continua; você pode conectar de novo quando quiser.",
            confirm = "Desconectar",
            onDismiss = { confirmDisconnectBank = false },
            onConfirm = {
                confirmDisconnectBank = false
                vm.disconnectBank(onDone = onBankDisconnected)
            },
        )
    }
    if (deleteAccount) {
        DeleteAccountDialog(
            onDismiss = { deleteAccount = false },
            onConfirm = { password, onError ->
                vm.deleteAccount(password) { msg ->
                    onError(msg)
                }
            },
        )
    }
}

@Composable
private fun ConfirmDialog(title: String, body: String, confirm: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = OttoColors.Elevated,
        title = { Text(title, style = OttoType.Title, color = OttoColors.Text) },
        text = { Text(body, style = OttoType.Body, color = OttoColors.Text3) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirm, color = OttoColors.Text) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar", color = OttoColors.Text2) } },
    )
}

@Composable
private fun DeleteAccountDialog(onDismiss: () -> Unit, onConfirm: (String, (String) -> Unit) -> Unit) {
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = OttoColors.Elevated,
        title = { Text("Excluir minha conta", style = OttoType.Title, color = OttoColors.Text) },
        text = {
            Column {
                Text(
                    "Isso apaga sua conta e todos os seus dados no servidor, e revoga a conexão com o Nubank. Não dá para desfazer. Digite sua senha para confirmar.",
                    style = OttoType.Caption,
                    color = OttoColors.Text2,
                )
                Spacer(Modifier.height(16.dp))
                OttoTextField(
                    value = password,
                    onValueChange = {
                        password = it
                        error = null
                    },
                    label = "Senha",
                    password = true,
                    imeAction = ImeAction.Done,
                    onDone = { if (password.isNotEmpty()) onConfirm(password) { error = it } },
                )
                error?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, style = OttoType.Caption, color = OttoColors.Text)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { if (password.isNotEmpty()) onConfirm(password) { error = it } }) { Text("Excluir", color = OttoColors.Text) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar", color = OttoColors.Text2) } },
    )
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
private fun Section(title: String, description: String? = null, index: Int = 0, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().enterAnimation(index)) {
        Text(
            title,
            style = OttoType.Section,
            color = OttoColors.Text,
            modifier = Modifier.padding(start = 4.dp, top = 28.dp, bottom = if (description == null) 10.dp else 2.dp).semantics { heading() },
        )
        if (description != null) {
            Text(description, style = OttoType.Caption, color = OttoColors.Text2, modifier = Modifier.padding(start = 4.dp, bottom = 12.dp))
        }
        OttoCard(Modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 4.dp), content = content)
    }
}

/** Linha só de leitura (sem seta): ícone, rótulo e valor. */
@Composable
private fun InfoRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        RowIcon(icon)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(label, style = OttoType.Caption, color = OttoColors.Text2)
            Text(value, style = OttoType.Body, color = OttoColors.Text, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun Divider() {
    HorizontalDivider(color = OttoColors.Border, thickness = 1.dp)
}
