package app.otto.ui.chat

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
import app.otto.ui.components.AskField
import app.otto.ui.components.ChatCardView
import app.otto.ui.components.Chip
import app.otto.ui.components.CircleIconButton
import app.otto.ui.components.ScreenPadding
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.graphics.graphicsLayer
import app.otto.ui.components.PillShape
import app.otto.ui.components.enterAnimation
import app.otto.ui.components.OttoIcons
import app.otto.ui.components.OttoMark
import app.otto.ui.components.rememberHaptic
import app.otto.ui.components.richText
import app.otto.ui.theme.OttoColors
import app.otto.ui.theme.OttoType

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
            .background(OttoColors.Bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircleIconButton(OttoIcons.ArrowLeft, "Voltar", onClick = onBack)
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Otto", style = OttoType.Title, color = OttoColors.Text, modifier = Modifier.semantics { heading() })
                ModelPill(state.modelLabel)
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
                itemsIndexed(reversed, key = { _, m -> m.id }) { index, msg ->
                    // só as duas mais novas entram animadas (o histórico antigo aparece direto)
                    val modifier = Modifier.animateItem().then(if (index < 2) Modifier.enterAnimation(0, offsetPx = 40f) else Modifier)
                    if (msg.fromUser) UserMessage(msg, modifier) else OttoMessage(msg, showTyping = msg.streaming && state.typing, modifier = modifier)
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
private fun UserMessage(msg: UiMessage, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(
            msg.text,
            style = OttoType.Body,
            color = OttoColors.OnPrimary,
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(UserBubble)
                .background(OttoColors.Text)
                .padding(horizontal = 16.dp, vertical = 12.dp),
        )
    }
}

/** Resposta do Otto: sem bolha, texto direto no fundo preto. */
@Composable
private fun OttoMessage(msg: UiMessage, showTyping: Boolean, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .animateContentSize(tween(200))
            .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        if (showTyping && msg.text.isEmpty()) {
            TypingDots()
        } else {
            Text(
                richText(msg.text),
                style = OttoType.Chat,
                color = if (msg.error) OttoColors.Text2 else OttoColors.Text,
            )
        }
        msg.cards.forEach { card ->
            Spacer(Modifier.height(12.dp))
            ChatCardView(card)
        }
    }
}

/** Modelo em uso, no topo (igual ao rótulo de modelo do Claude): troca com um fade suave. */
@Composable
private fun ModelPill(label: String) {
    AnimatedContent(
        targetState = label,
        transitionSpec = { (fadeIn(tween(260)) + slideInVertically(tween(260)) { it / 3 }) togetherWith (fadeOut(tween(160)) + slideOutVertically(tween(160)) { -it / 3 }) },
        label = "model",
    ) { text ->
        if (text.isNotEmpty()) {
            Row(
                Modifier
                    .padding(top = 4.dp)
                    .clip(PillShape)
                    .background(OttoColors.Surface)
                    .border(1.dp, OttoColors.Border2, PillShape)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(OttoColors.Text))
                Spacer(Modifier.width(7.dp))
                Text(text, style = OttoType.Small, color = OttoColors.Text2, maxLines = 1)
            }
        } else {
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun TypingDots() {
    val t = rememberInfiniteTransition(label = "typing")
    Row(
        Modifier.height(24.dp).semantics { contentDescription = "Otto está digitando" },
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
            val lift by t.animateFloat(
                initialValue = 0f,
                targetValue = -5f,
                animationSpec = infiniteRepeatable(tween(450, delayMillis = i * 150), RepeatMode.Reverse),
                label = "lift$i",
            )
            Box(Modifier.size(7.dp).graphicsLayer { translationY = lift.dp.toPx() }.alpha(a).clip(CircleShape).background(OttoColors.Text))
        }
    }
}

@Composable
private fun EmptyChat(modifier: Modifier = Modifier) {
    Column(modifier.padding(horizontal = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        OttoMark(56.dp, dark = true)
        Spacer(Modifier.height(16.dp))
        Text("Pergunte sobre a sua conta", style = OttoType.Section, color = OttoColors.Text)
        Spacer(Modifier.height(6.dp))
        Text(
            "“Quanto entrou hoje?”, “Qual foi minha maior saída da semana?”, “Quanto gastei no mercado este mês?”",
            style = OttoType.Caption,
            color = OttoColors.Text2,
            textAlign = TextAlign.Center,
        )
    }
}
