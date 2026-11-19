package app.tony

import android.app.Application
import app.tony.notify.Notifications
import app.tony.security.AppLock
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class TonyApp : Application() {

    @Inject lateinit var lock: AppLock

    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        lock.install()
    }
}
