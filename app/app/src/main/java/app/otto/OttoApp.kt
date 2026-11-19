package app.otto

import android.app.Application
import app.otto.notify.Notifications
import app.otto.security.AppLock
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class OttoApp : Application() {

    @Inject lateinit var lock: AppLock

    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        lock.install()
    }
}
