package app.tony.bank

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationManagerCompat
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.security.MessageDigest
import javax.inject.Inject

/**
 * Lê as notificações do app do Nubank neste celular para avisar em segundos (o Open Finance
 * pode levar horas). Só olha notificações do pacote do Nubank; todas as outras são ignoradas
 * sem serem lidas. O texto bruto não sai do aparelho: ao servidor vão só valor, nome, tipo
 * e horário.
 *
 * Requer que o usuário conceda "Acesso a notificações" nas configurações do Android.
 */
@AndroidEntryPoint
class BankNotificationListener : NotificationListenerService() {

    @Inject lateinit var sender: BankEventSender

    @Inject lateinit var diagnostics: BankDiagnostics

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val n = sbn ?: return
        if (n.packageName !in BankNotificationParser.PACKAGES) return
        val notification = n.notification ?: return
        if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

        val extras = notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        // o texto expandido costuma ser o mais completo
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
            ?.toString().orEmpty()
        if (title.isBlank() && text.isBlank()) return

        val now = System.currentTimeMillis()
        // horário do evento informado pelo próprio app do banco, se for plausível
        val occurredAt = notification.`when`.takeIf { it in (now - MAX_AGE_MS)..(now + 60_000) } ?: now
        val fingerprint = fingerprint(n.packageName, n.key, notification.`when`, title, text)

        scope.launch {
            when (val r = BankNotificationParser.parse(title, text)) {
                is ParseResult.Parsed -> {
                    // a mesma notificação reapresentada (atualização, reconexão) não é reenviada
                    if (!sender.claim(fingerprint)) return@launch
                    diagnostics.recordRecognized(summaryOf(r.event))
                    sender.send(r.event, fingerprint, occurredAt)
                }
                is ParseResult.Ignored -> {
                    if (r.moneyRelated && sender.claim(fingerprint)) diagnostics.recordUnrecognized(title, text, r.reason)
                }
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val MAX_AGE_MS = 72L * 3600_000

        fun fingerprint(pkg: String, key: String, whenMillis: Long, title: String, text: String): String {
            val raw = listOf(pkg, key, whenMillis.toString(), BankNotificationParser.normalizeSpaces(title), BankNotificationParser.normalizeSpaces(text))
                .joinToString("\u0001")
            return MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
        }

        private fun summaryOf(e: ParsedBankEvent): String =
            (if (e.amountCents > 0) "Entrada" else "Saída") + (e.counterpart?.let { " · $it" } ?: "")

        fun isEnabled(context: Context): Boolean =
            NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

        fun component(context: Context) = ComponentName(context, BankNotificationListener::class.java)

        fun isBankAppInstalled(context: Context): Boolean = BankNotificationParser.PACKAGES.any { pkg ->
            runCatching { context.packageManager.getPackageInfo(pkg, 0) }.isSuccess
        }
    }
}
