package app.otto.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class TxDto(
    val id: Long,
    val occurredAt: String,
    val localDate: String,
    val time: String? = null,
    val amountCents: Long,
    val title: String,
    val subtitle: String,
    val description: String,
    val counterpart: String? = null,
    val method: String? = null,
    val category: String? = null,
    val status: String = "POSTED",
    /** Movimentação com as caixinhas: aparece na lista, mas não conta nos totais. */
    val internal: Boolean = false,
)

@Serializable
data class DayPoint(
    val date: String,
    val inCents: Long,
    val outCents: Long,
    val netCents: Long,
    val closingBalanceCents: Long,
)

@Serializable
data class TodayDto(val date: String, val label: String, val inCents: Long, val outCents: Long)

@Serializable
data class WeekDto(val from: String, val to: String, val inCents: Long, val outCents: Long, val netCents: Long)

@Serializable
data class Summary(
    val balanceCents: Long,
    val balanceUpdatedAt: String? = null,
    val lastSyncAt: String? = null,
    val today: TodayDto,
    val week: WeekDto,
    val series: List<DayPoint>,
    val recent: List<TxDto>,
    val reserves: Reserves = Reserves(),
    val cards: List<CreditCard> = emptyList(),
)

@Serializable
data class ReserveItem(val id: String, val name: String, val balanceCents: Long, val rateLabel: String? = null)

@Serializable
data class Reserves(
    val totalCents: Long = 0,
    val items: List<ReserveItem> = emptyList(),
    val updatedAt: String? = null,
)

@Serializable
data class BillForecast(val month: String, val totalCents: Long, val count: Int)

@Serializable
data class PastBill(val dueDate: String, val totalCents: Long, val minimumCents: Long? = null)

@Serializable
data class CreditCard(
    val id: String,
    val name: String,
    val last4: String? = null,
    val brand: String? = null,
    val level: String? = null,
    val openBillCents: Long,
    val creditLimitCents: Long? = null,
    val availableLimitCents: Long? = null,
    val usedLimitCents: Long? = null,
    val minimumPaymentCents: Long? = null,
    val closeDate: String? = null,
    val dueDate: String? = null,
    /** "banco" = informado pela instituição; "ajuste" = calculado pelo dia definido nos Ajustes. */
    val dueDateSource: String? = null,
    val upcomingBills: List<BillForecast> = emptyList(),
    val pastBills: List<PastBill> = emptyList(),
)

@Serializable
data class CardTx(
    val id: Long,
    val cardId: String,
    val occurredAt: String,
    val localDate: String,
    val time: String? = null,
    val amountCents: Long,
    val description: String,
    val category: String? = null,
    val status: String = "POSTED",
    val billMonth: String? = null,
    val installment: String? = null,
)

@Serializable
data class Wallet(
    val reserves: Reserves = Reserves(),
    val cards: List<CreditCard> = emptyList(),
    val cardTransactions: List<CardTx> = emptyList(),
)

@Serializable
data class TransactionsPage(val items: List<TxDto>, val nextCursor: String? = null)

@Serializable
data class ServerSettings(
    val bigOutflowThresholdCents: Long,
    val dailySummaryTime: String,
    val dailySummaryEnabled: Boolean,
    val notifyIncoming: Boolean,
    val notifyOutgoing: Boolean,
    val cardDueDay: Int? = null,
)

@Serializable
data class SettingsPatch(
    val bigOutflowThresholdCents: Long? = null,
    val dailySummaryTime: String? = null,
    val dailySummaryEnabled: Boolean? = null,
    val notifyIncoming: Boolean? = null,
    val notifyOutgoing: Boolean? = null,
)

@Serializable
data class ServerStatus(
    val mode: String,
    val connected: Boolean = true,
    val pushEnabled: Boolean,
    val ai: String,
    val aiProviders: List<String> = emptyList(),
    val aiModel: String? = null,
    val lastSyncAt: String? = null,
    val lastNotificationId: Long = 0,
    val version: String = "",
)

@Serializable
data class NotificationDto(
    val id: Long,
    val kind: String,
    val title: String,
    val body: String,
    val target: String = "home",
    val createdAt: String? = null,
)

@Serializable
data class NotificationsPage(val items: List<NotificationDto>, val lastId: Long)

@Serializable
data class DeviceBody(val fid: String, val platform: String = "android")

@Serializable
data class OkResponse(val ok: Boolean = true, val pushEnabled: Boolean? = null, val push: Boolean? = null)

@Serializable
data class SimulateBody(val direction: String? = null, val amountCents: Long? = null)

@Serializable
data class SimulatedNotification(val id: Long, val title: String, val body: String, val kind: String)

@Serializable
data class SimulateResult(
    val ok: Boolean,
    val notified: Boolean,
    val notification: SimulatedNotification? = null,
    val balanceCents: Long,
)

@Serializable
data class ChatTurnDto(val role: String, val content: String)

@Serializable
data class ChatRequest(val messages: List<ChatTurnDto>)

/** Cartões inline devolvidos pelo chat. O campo "type" escolhe a subclasse. */
@Serializable
sealed interface ChatCard {
    @Serializable
    @SerialName("balance")
    data class Balance(val title: String, val amountCents: Long) : ChatCard

    @Serializable
    @SerialName("period")
    data class Period(val title: String, val inCents: Long, val outCents: Long) : ChatCard

    @Serializable
    @SerialName("list")
    data class ListCard(val title: String, val items: List<Item>) : ChatCard {
        @Serializable
        data class Item(val title: String, val subtitle: String, val amountCents: Long)
    }

    @Serializable
    @SerialName("reserves")
    data class ReservesCard(val title: String, val totalCents: Long, val items: List<Item>) : ChatCard {
        @Serializable
        data class Item(val name: String, val subtitle: String, val amountCents: Long)
    }

    @Serializable
    @SerialName("credit")
    data class Credit(
        val title: String,
        val billCents: Long,
        val limitCents: Long? = null,
        val availableCents: Long? = null,
        val subtitle: String,
    ) : ChatCard

    @Serializable
    @SerialName("breakdown")
    data class Breakdown(val title: String, val items: List<Item>) : ChatCard {
        @Serializable
        data class Item(val label: String, val amountCents: Long, val pct: Double)
    }
}

@Serializable
data class ChatMeta(val mode: String, val provider: String? = null, val model: String? = null, val reason: String? = null)

@Serializable
data class ChatDelta(val text: String)

@Serializable
data class ChatError(val message: String)

/** Movimentação lida da notificação do app do banco (POST /v1/events/bank-notification). */
@Serializable
data class BankEventBody(
    val fingerprint: String,
    val amountCents: Long,
    val counterpart: String? = null,
    val method: String? = null,
    val occurredAt: String,
    val alreadyNotified: Boolean = false,
)

@Serializable
data class BankEventResponse(
    val ok: Boolean = true,
    val status: String,
    val balanceCents: Long = 0,
    val notification: NotificationDto? = null,
)
