package app.otto.bank

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.net.toUri

/** Atalhos para as telas do sistema necessárias para ativar a leitura de notificações. */
object ListenerSettings {

    /** Abre direto o "Acesso a notificações" do Otto (Android 11+), ou a lista geral. */
    fun openNotificationAccess(context: Context) {
        val detail = if (Build.VERSION.SDK_INT >= 30) {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(
                    Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                    BankNotificationListener.component(context).flattenToString(),
                )
        } else {
            null
        }
        val general = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        for (intent in listOfNotNull(detail, general)) {
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return
            } catch (_: ActivityNotFoundException) {
                // tenta a próxima
            } catch (_: SecurityException) {
            }
        }
        openAppInfo(context)
    }

    /**
     * Android 13+: para apps instalados fora da loja, o acesso a notificações fica bloqueado
     * até liberar em Informações do app > ⋮ > "Permitir configurações restritas".
     */
    fun openAppInfo(context: Context) {
        runCatching {
            context.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${context.packageName}".toUri())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}
