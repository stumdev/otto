package app.tony.ui.chat

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tony.ui.components.AskField
import app.tony.ui.components.ChatCardView
import app.tony.ui.components.Chip
import app.tony.ui.components.CircleIconButton
import app.tony.ui.components.ScreenPadding
import app.tony.ui.components.StatusLine
import app.tony.ui.components.TonyIcons
import app.tony.ui.components.TonyMark
import app.tony.ui.components.rememberHaptic
import app.tony.ui.components.richText
import app.tony.ui.theme.TonyColors
import app.tony.ui.theme.TonyType

/** Atalhos rápidos acima do campo. */
private val QUICK = listOf(
    "Dia a dia" to "Como foi hoje? Quanto entrou e quanto saiu?",
    "Maiores saídas" to "Quais foram as maiores saídas da semana?",
    "Saldo agora" to "Qual é o meu saldo agora?",
)

private val UserBubble = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 6.dp, bottomStart = 22.dp)

@Composable
fun ChatScreen(onBack: () -> Unit, vm: ChatViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var input by rememberSaveable { mutableStateOf("") }
    val haptic = rememberHaptic()
    val listState = rememberLazyListState()

    // mensagens alinhadas embaixo: lista invertida, a mais nova no índice 0
    val reversed = state.messages.asReversed()
    LaunchedEffect(state.messages.size, state.typing) {
        if (reversed.isNotEmpty()) listState.animateScrollToItem(0)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(TonyColors.Bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircleIconButton(TonyIcons.ArrowLeft, "Voltar", onClick = onBack)
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Tony", style = TonyType.Title, color = TonyColors.Text, modifier = Modifier.semantics { heading() })
                StatusLine(state.syncLabel)
            }
            Spacer(Modifier.size(48.dp))
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (state.loaded && state.messages.isEmpty()) {
                EmptyChat(Modifier.align(Alignment.Center))
            }
            LazyColumn(
                state = listState,
                reverseLayout = true,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = ScreenPadding, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.Bottom),
            ) {
                items(reversed, key = { it.id }) { msg ->
                    if (msg.fromUser) UserMessage(msg) else TonyMessage(msg, showTyping = msg.streaming && state.typing)
                }
            }
        }

        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = ScreenPadding),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            QUICK.forEach { (label, prompt) ->
                Chip(label, enabled = !state.sending, onClick = {
                    haptic()
                    vm.send(prompt)
                })
            }
        }
        Spacer(Modifier.height(10.dp))
        AskField(
            value = input,
            onValueChange = { input = it },
            enabled = !state.sending,
            onSend = {
                haptic()
                vm.send(input)
                input = ""
            },
            modifier = Modifier.padding(start = ScreenPadding, end = ScreenPadding, bottom = 12.dp),
        )
    }
}

@Composable
private fun UserMessage(msg: UiMessage) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(
            msg.text,
            style = TonyType.Body,
            color = TonyColors.OnPrimary,
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(UserBubble)
                .background(TonyColors.Text)
                .padding(horizontal = 16.dp, vertical = 12.dp),
        )
    }
}

/** Resposta do Tony: sem bolha, texto direto no fundo preto. */
@Composable
private fun TonyMessage(msg: UiMessage, showTyping: Boolean) {
    Column(
        Modifier
            .fillMaxWidth()
            .animateContentSize(tween(200))
            .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        if (showTyping && msg.text.isEmpty()) {
            TypingDots()
        } else {
            Text(
                richText(msg.text),
                style = TonyType.Chat,
                color = if (msg.error) TonyColors.Text2 else TonyColors.Text,
            )
        }
        msg.cards.forEach { card ->
            Spacer(Modifier.height(12.dp))
            ChatCardView(card)
        }
        if (msg.offline && !msg.streaming) {
            Spacer(Modifier.height(8.dp))
            Text("Modo offline · resposta por regras, sem IA", style = TonyType.Small, color = TonyColors.Text2)
        }
    }
}

@Composable
private fun TypingDots() {
    val t = rememberInfiniteTransition(label = "typing")
    Row(
        Modifier.height(24.dp).semantics { contentDescription = "Tony está digitando" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        repeat(3) { i ->
            val a by t.animateFloat(
                initialValue = 0.25f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(450, delayMillis = i * 150), RepeatMode.Reverse),
                label = "dot$i",
            )
            Box(Modifier.size(6.dp).alpha(a).clip(CircleShape).background(TonyColors.Text))
        }
    }
}

@Composable
private fun EmptyChat(modifier: Modifier = Modifier) {
    Column(modifier.padding(horizontal = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        TonyMark(56.dp, dark = true)
        Spacer(Modifier.height(16.dp))
        Text("Pergunte sobre a sua conta", style = TonyType.Section, color = TonyColors.Text)
        Spacer(Modifier.height(6.dp))
        Text(
            "“Quanto entrou hoje?”, “Qual foi minha maior saída da semana?”, “Quanto gastei no mercado este mês?”",
            style = TonyType.Caption,
            color = TonyColors.Text2,
            textAlign = TextAlign.Center,
        )
    }
}
