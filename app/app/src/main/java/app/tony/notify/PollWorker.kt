package app.tony.notify

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent

@EntryPoint
@InstallIn(SingletonComponent::class)
interface PushEntryPoint {
    fun pushManager(): PushManager
}

/** Polling periódico da outbox (fallback quando não há FCM). */
class PollWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val push = EntryPointAccessors.fromApplication(applicationContext, PushEntryPoint::class.java).pushManager()
        push.syncFid()
        push.pollNow()
        return Result.success()
    }

    companion object {
        const val NAME = "tony-poll"
    }
}
