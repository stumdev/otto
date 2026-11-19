package app.otto.ui.components

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
import app.otto.data.ChatCard
import app.otto.data.Money
import app.otto.ui.theme.OttoColors
import app.otto.ui.theme.OttoType

/** Cartões inline nas respostas do Otto (superfície #0F0F0F, borda #1C1C1C). */
@Composable
fun ChatCardView(card: ChatCard, modifier: Modifier = Modifier) {
    when (card) {
        is ChatCard.Balance -> OttoCard(modifier.fillMaxWidth()) {
            Text(card.title, style = OttoType.Caption, color = OttoColors.Text2)
            Spacer(Modifier.height(6.dp))
            Text(Money.brl(card.amountCents), style = OttoType.CardValue, color = OttoColors.Text)
        }

        is ChatCard.Period -> OttoCard(modifier.fillMaxWidth()) {
            Text(card.title, style = OttoType.Caption, color = OttoColors.Text2)
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth()) {
                LabeledAmount("Entrou", card.inCents, Modifier.weight(1f))
                LabeledAmount("Saiu", -card.outCents, Modifier.weight(1f))
            }
            Spacer(Modifier.height(14.dp))
            ProportionBar(card.inCents, card.outCents)
        }

        is ChatCard.ReservesCard -> OttoCard(modifier.fillMaxWidth()) {
            Text(card.title, style = OttoType.Caption, color = OttoColors.Text2)
            Spacer(Modifier.height(6.dp))
            Text(Money.brl(card.totalCents), style = OttoType.CardValue, color = OttoColors.Text)
            card.items.forEach { TxRow(it.name, it.subtitle, it.amountCents, Modifier.padding(vertical = 2.dp)) }
        }

        is ChatCard.Credit -> OttoCard(modifier.fillMaxWidth()) {
            Text(card.title, style = OttoType.Caption, color = OttoColors.Text2)
            Spacer(Modifier.height(6.dp))
            Text("Fatura atual " + Money.brl(card.billCents), style = OttoType.CardValue, color = OttoColors.Text)
            Spacer(Modifier.height(4.dp))
            Text(card.subtitle, style = OttoType.Small, color = OttoColors.Text2)
            if (card.limitCents != null && card.availableCents != null) {
                Spacer(Modifier.height(10.dp))
                ProportionBar(card.availableCents, (card.limitCents - card.availableCents).coerceAtLeast(0))
                Spacer(Modifier.height(4.dp))
                Text("Disponível ${Money.brl(card.availableCents)} de ${Money.brl(card.limitCents)}", style = OttoType.Small, color = OttoColors.Text2)
            }
        }

        is ChatCard.Breakdown -> OttoCard(modifier.fillMaxWidth()) {
            Text(card.title, style = OttoType.Caption, color = OttoColors.Text2)
            card.items.forEach {
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth()) {
                    Text(it.label, style = OttoType.Body, color = OttoColors.Text, modifier = Modifier.weight(1f))
                    AmountText(it.amountCents, OttoType.Body)
                }
            }
        }

        is ChatCard.ListCard ->OttoCard(modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 14.dp)) {
            Text(card.title, style = OttoType.Caption, color = OttoColors.Text2)
            Spacer(Modifier.height(6.dp))
            card.items.forEach { TxRow(it.title, it.subtitle, it.amountCents, Modifier.padding(vertical = 2.dp)) }
        }
    }
}

@Composable
private fun LabeledAmount(label: String, cents: Long, modifier: Modifier = Modifier) {
    androidx.compose.foundation.layout.Column(modifier) {
        Text(label, style = OttoType.Small, color = OttoColors.Text2)
        Spacer(Modifier.height(2.dp))
        AmountText(cents, OttoType.CardValue)
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
            .background(OttoColors.Border)
            .semantics { contentDescription = "Entradas $pct%, saídas ${100 - pct}% do movimento" },
    ) {
        Row(Modifier.fillMaxWidth().fillMaxHeight(), verticalAlignment = Alignment.CenterVertically) {
            if (inFrac > 0f) Box(Modifier.weight(inFrac).fillMaxHeight().background(OttoColors.Text))
            if (inFrac > 0f && inFrac < 1f) Spacer(Modifier.width(2.dp))
            if (inFrac < 1f && outCents > 0) Box(Modifier.weight(1f - inFrac).fillMaxHeight().background(OttoColors.Text2))
        }
    }
}
