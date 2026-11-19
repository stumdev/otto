package app.tony.notify

import android.annotation.SuppressLint
import app.tony.data.AppPrefs
import app.tony.data.NotificationDto
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Recebe o FID (onRegistered) e as mensagens de dados do servidor.
 * O servidor manda só "data" (sem bloco "notification"), então montamos a
 * notificação aqui, com o canal e o destino certos.
 */
// O lint ainda procura onNewToken(), do modelo antigo de registration tokens. Usamos o
// modelo novo por Firebase Installation ID, cujo callback equivalente é onRegistered().
@SuppressLint("MissingFirebaseInstanceTokenRefresh")
@AndroidEntryPoint
class TonyMessagingService : FirebaseMessagingService() {

    @Inject lateinit var prefs: AppPrefs

    @Inject lateinit var push: PushManager

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onRegistered(installationId: String) {
        if (prefs.fid != installationId) prefs.fid = installationId
        scope.launch {
            push.syncFid()
            push.refreshPushState()
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        val title = d["title"] ?: return
        val body = d["body"] ?: return
        push.showFromPush(
            NotificationDto(
                id = d["id"]?.toLongOrNull() ?: 0L,
                kind = d["kind"] ?: "summary",
                title = title,
                body = body,
                target = d["target"] ?: "home",
            ),
        )
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
