package app.otto.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import app.otto.MainActivity
import app.otto.R
import app.otto.data.NotificationDto
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

object Notifications {
    const val CH_IN = "entradas"
    const val CH_OUT = "saidas"
    const val CH_SUMMARY = "resumo"
    const val EXTRA_TARGET = "otto.target"

    private val _inApp = MutableSharedFlow<NotificationDto>(extraBufferCapacity = 8)

    /** Notificações recebidas com o app aberto: viram um banner dentro do app. */
    val inApp: SharedFlow<NotificationDto> = _inApp.asSharedFlow()

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CH_IN, context.getString(R.string.channel_in), NotificationManager.IMPORTANCE_HIGH)
                    .apply { description = context.getString(R.string.channel_in_desc) },
                NotificationChannel(CH_OUT, context.getString(R.string.channel_out), NotificationManager.IMPORTANCE_HIGH)
                    .apply { description = context.getString(R.string.channel_out_desc) },
                NotificationChannel(CH_SUMMARY, context.getString(R.string.channel_summary), NotificationManager.IMPORTANCE_DEFAULT)
                    .apply { description = context.getString(R.string.channel_summary_desc) },
            ),
        )
    }

    fun channelFor(kind: String): String = when (kind) {
        "in" -> CH_IN
        "out", "out_big" -> CH_OUT
        else -> CH_SUMMARY
    }

    private fun isAppInForeground(): Boolean =
        ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    /**
     * Exibe uma notificação do servidor. Com o app aberto, mostra o banner interno;
     * com o app em segundo plano, usa a notificação do sistema.
     */
    fun show(context: Context, n: NotificationDto) {
        if (isAppInForeground()) {
            _inApp.tryEmit(n)
            return
        }
        post(context, n)
    }

    fun post(context: Context, n: NotificationDto) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_TARGET, n.target)
        }
        val requestCode = (n.id % Int.MAX_VALUE).toInt()
        val pi = PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, channelFor(n.kind))
            .setSmallIcon(R.drawable.ic_stat_otto)
            .setColor(ContextCompat.getColor(context, R.color.otto_white))
            .setContentTitle(n.title)
            .setContentText(n.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.body))
            .setCategory(if (n.kind == "summary") NotificationCompat.CATEGORY_STATUS else NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(if (n.kind == "summary") NotificationCompat.PRIORITY_DEFAULT else NotificationCompat.PRIORITY_HIGH)
            // valores aparecem na tela de bloqueio só como "conteúdo oculto"
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                NotificationCompat.Builder(context, channelFor(n.kind))
                    .setSmallIcon(R.drawable.ic_stat_otto)
                    .setContentTitle("Otto")
                    .setContentText("Nova movimentação na conta")
                    .build(),
            )
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        NotificationManagerCompat.from(context).notify(requestCode, notification)
    }
}
