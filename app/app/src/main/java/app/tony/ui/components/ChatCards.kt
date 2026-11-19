package app.tony.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.tony.data.ChatCard
import app.tony.data.Money
import app.tony.ui.theme.TonyColors
import app.tony.ui.theme.TonyType

/** Cartões inline nas respostas do Tony (superfície #0F0F0F, borda #1C1C1C). */
@Composable
fun ChatCardView(card: ChatCard, modifier: Modifier = Modifier) {
    when (card) {
        is ChatCard.Balance -> TonyCard(modifier.fillMaxWidth()) {
            Text(card.title, style = TonyType.Caption, color = TonyColors.Text2)
            Spacer(Modifier.height(6.dp))
            Text(Money.brl(card.amountCents), style = TonyType.CardValue, color = TonyColors.Text)
        }

        is ChatCard.Period -> TonyCard(modifier.fillMaxWidth()) {
            Text(card.title, style = TonyType.Caption, color = TonyColors.Text2)
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth()) {
                LabeledAmount("Entrou", card.inCents, Modifier.weight(1f))
                LabeledAmount("Saiu", -card.outCents, Modifier.weight(1f))
            }
            Spacer(Modifier.height(14.dp))
            ProportionBar(card.inCents, card.outCents)
        }

        is ChatCard.ListCard -> TonyCard(modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 14.dp)) {
            Text(card.title, style = TonyType.Caption, color = TonyColors.Text2)
            Spacer(Modifier.height(6.dp))
            card.items.forEach { TxRow(it.title, it.subtitle, it.amountCents, Modifier.padding(vertical = 2.dp)) }
        }
    }
}

@Composable
private fun LabeledAmount(label: String, cents: Long, modifier: Modifier = Modifier) {
    androidx.compose.foundation.layout.Column(modifier) {
        Text(label, style = TonyType.Small, color = TonyColors.Text2)
        Spacer(Modifier.height(2.dp))
        AmountText(cents, TonyType.CardValue)
    }
}

/** Barra de proporção entrou × saiu. Entrada em branco, saída em cinza (o rótulo diz qual é qual). */
@Composable
fun ProportionBar(inCents: Long, outCents: Long, modifier: Modifier = Modifier) {
    val total = (inCents + outCents).coerceAtLeast(1)
    val inFrac = (inCents.toFloat() / total).coerceIn(0f, 1f)
    val pct = (inFrac * 100).toInt()
    val shape = RoundedCornerShape(4.dp)
    Box(
        modifier
            .fillMaxWidth()
            .height(6.dp)
            .clip(shape)
            .background(TonyColors.Border)
            .semantics { contentDescription = "Entradas $pct%, saídas ${100 - pct}% do movimento" },
    ) {
        Row(Modifier.fillMaxWidth().fillMaxHeight(), verticalAlignment = Alignment.CenterVertically) {
            if (inFrac > 0f) Box(Modifier.weight(inFrac).fillMaxHeight().background(TonyColors.Text))
            if (inFrac > 0f && inFrac < 1f) Spacer(Modifier.width(2.dp))
            if (inFrac < 1f && outCents > 0) Box(Modifier.weight(1f - inFrac).fillMaxHeight().background(TonyColors.Text2))
        }
    }
}
