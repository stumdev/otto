package app.otto.notify

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import app.otto.BuildConfig
import app.otto.data.AppPrefs
import app.otto.data.NotificationDto
import app.otto.data.OttoRepository
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Decide como as notificações chegam:
 *  - FCM (push) quando o app tem google-services.json E o servidor tem o Firebase configurado;
 *  - senão, polling da outbox do servidor (WorkManager a cada 15 min, o mínimo do Android,
 *    e a cada ~20 s enquanto o app está aberto), exibindo notificações locais.
 * O id da outbox evita mostrar a mesma notificação duas vezes nos dois caminhos.
 */
@Singleton
class PushManager @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val prefs: AppPrefs,
    private val repo: OttoRepository,
) {
    private val pollLock = Mutex()

    val fcmAvailable: Boolean
        get() = BuildConfig.FCM_CONFIGURED && FirebaseApp.getApps(context).isNotEmpty()

    /** Chamado no início do app e após configurar o servidor. */
    suspend fun ensureRegistered() {
        if (!prefs.config.value.isConfigured) return
        if (fcmAvailable) {
            runCatching { FirebaseMessaging.getInstance().register() }
                .onFailure { Log.w(TAG, "FCM register falhou: ${it.javaClass.simpleName}") }
        }
        syncFid()
        refreshPushState()
        schedulePolling()
        // na primeira vez, alinha o ponteiro da outbox (sem exibir o histórico)
        if (prefs.lastNotificationId < 0) pollNow(force = true)
    }

    /** Envia o FID ao servidor (se ainda não foi). */
    suspend fun syncFid() {
        val fid = prefs.fid ?: return
        if (prefs.fidSynced || !prefs.config.value.isConfigured) return
        runCatching { repo.registerDevice(fid) }
            .onSuccess { prefs.fidSynced = true }
            .onFailure { Log.w(TAG, "registro do aparelho falhou: ${it.javaClass.simpleName}") }
    }

    suspend fun refreshPushState() {
        val status = runCatching { repo.status() }.getOrNull() ?: return
        prefs.pushActive = fcmAvailable && prefs.fidSynced && status.pushEnabled
    }

    fun schedulePolling() {
        val req = PeriodicWorkRequestBuilder<PollWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PollWorker.NAME, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    /** Marca como vista uma notificação que chegou por push. */
    fun markSeen(id: Long) {
        if (id > prefs.lastNotificationId) prefs.lastNotificationId = id
    }

    /**
     * Busca notificações novas na outbox e exibe localmente.
     * Na primeira vez só sincroniza o ponteiro (não despeja o histórico).
     * Com push ativo não faz nada, a menos que [force].
     */
    suspend fun pollNow(force: Boolean = false): Int = pollLock.withLock {
        if (!prefs.config.value.isConfigured) return 0
        if (prefs.pushActive && !force) return 0
        val last = prefs.lastNotificationId
        val page = runCatching { repo.notifications(after = maxOf(last, 0)) }.getOrNull() ?: return 0
        if (last < 0) {
            prefs.lastNotificationId = page.lastId
            return 0
        }
        var shown = 0
        for (n in page.items) {
            if (showOnce(n)) shown++
            // o ponteiro da outbox só avança aqui, em ordem: nada fica para trás
            if (n.id > prefs.lastNotificationId) prefs.lastNotificationId = n.id
        }
        return shown
    }

    /** Push (FCM) ou resposta do servidor: exibe se ainda não foi exibida. */
    fun showFromPush(n: NotificationDto) {
        showOnce(n)
    }

    /**
     * Ponto único de exibição. Push, polling e a resposta da leitura da notificação do banco
     * podem trazer a mesma notificação quase ao mesmo tempo; o id da outbox garante uma só
     * (lista persistida dos últimos ids exibidos). Ids <= 0 são avisos locais e sempre aparecem.
     */
    @Synchronized
    private fun showOnce(n: NotificationDto): Boolean {
        if (n.id > 0) {
            val shown = prefs.shownNotificationIds
            if (n.id in shown) return false
            prefs.shownNotificationIds = (shown + n.id).takeLast(MAX_SHOWN_IDS)
            // com push ativo o polling fica parado; mantém o ponteiro alinhado para o caso de o FCM cair
            if (prefs.pushActive) markSeen(n.id)
        }
        Notifications.show(context, n)
        return true
    }

    private companion object {
        const val TAG = "OttoPush"
        const val MAX_SHOWN_IDS = 100
    }
}
