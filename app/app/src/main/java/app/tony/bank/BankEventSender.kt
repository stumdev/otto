package app.tony.bank

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.tony.data.AppPrefs
import app.tony.data.BankEventBody
import app.tony.data.Money
import app.tony.data.Network
import app.tony.data.NotificationDto
import app.tony.data.TonyRepository
import app.tony.notify.PushManager
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import retrofit2.HttpException
import java.time.Instant
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Leva uma movimentação lida da notificação do banco até o servidor.
 * - Servidor respondeu: mostra a notificação do Tony (com saldo) devolvida por ele.
 * - Servidor fora do ar: mostra na hora um aviso local (sem saldo) e agenda o reenvio
 *   com alreadyNotified=true, para o servidor não avisar de novo.
 */
@Singleton
class BankEventSender @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val repo: TonyRepository,
    private val prefs: AppPrefs,
    private val push: PushManager,
) {
    /** Retorna false se esta notificação já foi processada antes. */
    @Synchronized
    fun claim(fingerprint: String): Boolean {
        val fps = prefs.bankFingerprints
        if (fingerprint in fps) return false
        prefs.bankFingerprints = (fps + fingerprint).takeLast(200)
        return true
    }

    suspend fun send(event: ParsedBankEvent, fingerprint: String, occurredAtMillis: Long) {
        if (!prefs.config.value.isConfigured) return
        val body = BankEventBody(
            fingerprint = fingerprint,
            amountCents = event.amountCents,
            counterpart = event.counterpart,
            method = event.method,
            occurredAt = Instant.ofEpochMilli(occurredAtMillis).toString(),
        )
        try {
            val r = repo.bankNotification(body)
            r.notification?.let { push.showFromPush(it) }
        } catch (e: HttpException) {
            if (e.code() == 429 || e.code() >= 500) fallback(event, body)
            else Log.w(TAG, "servidor recusou a movimentação lida (HTTP ${e.code()})")
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            fallback(event, body)
        }
    }

    private fun fallback(event: ParsedBankEvent, body: BankEventBody) {
        val inc = event.amountCents > 0
        val label = event.counterpart?.let {
            val m = when (event.method) { "PIX" -> "Pix"; "TED" -> "TED"; else -> if (inc) "Recebido" else "Pago" }
            "$m ${if (inc) "de" else "para"} $it"
        } ?: "Lido da notificação do banco"
        push.showFromPush(
            NotificationDto(
                // id negativo = aviso local, sem outbox
                id = -((body.fingerprint.take(12).toLong(16) % Int.MAX_VALUE) + 1),
                kind = if (inc) "in" else "out",
                title = "${if (inc) "Entrou" else "Saiu"} ${Money.brl(event.amountCents)}",
                body = "$label · saldo atualiza quando o servidor responder",
            ),
        )
        enqueueRetry(body.copy(alreadyNotified = true))
    }

    private fun enqueueRetry(body: BankEventBody) {
        val req = OneTimeWorkRequestBuilder<BankEventRetryWorker>()
            .setInputData(workDataOf(BankEventRetryWorker.KEY_BODY to Network.json.encodeToString(BankEventBody.serializer(), body)))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork("bank-${body.fingerprint}", ExistingWorkPolicy.KEEP, req)
    }

    private companion object {
        const val TAG = "TonyBank"
    }
}

@EntryPoint
@InstallIn(SingletonComponent::class)
interface BankEntryPoint {
    fun repository(): TonyRepository
}

/** Reenvia a movimentação quando a rede/servidor voltarem (até ~72 h, limite aceito pelo servidor). */
class BankEventRetryWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val raw = inputData.getString(KEY_BODY) ?: return Result.success()
        val body = runCatching { Network.json.decodeFromString(BankEventBody.serializer(), raw) }.getOrNull()
            ?: return Result.success()
        if (runAttemptCount >= MAX_ATTEMPTS) return Result.success()
        val repo = EntryPointAccessors.fromApplication(applicationContext, BankEntryPoint::class.java).repository()
        return try {
            repo.bankNotification(body)
            Result.success()
        } catch (e: HttpException) {
            if (e.code() == 429 || e.code() >= 500) Result.retry() else Result.success() // 4xx: inválido, descarta
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            Result.retry()
        }
    }

    companion object {
        const val KEY_BODY = "body"
        const val MAX_ATTEMPTS = 15
    }
}
