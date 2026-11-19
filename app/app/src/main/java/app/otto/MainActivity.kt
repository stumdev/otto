package app.otto

import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.compose.rememberNavController
import app.otto.data.AppPrefs
import app.otto.data.NotificationDto
import app.otto.notify.Notifications
import app.otto.notify.PushManager
import app.otto.security.AppLock
import app.otto.ui.OttoNavHost
import app.otto.ui.components.NotificationCard
import app.otto.ui.components.ScreenPadding
import app.otto.ui.lock.LockScreen
import app.otto.ui.theme.OttoColors
import app.otto.ui.theme.OttoTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : FragmentActivity() {

    @Inject lateinit var prefs: AppPrefs

    @Inject lateinit var lock: AppLock

    @Inject lateinit var push: PushManager

    private val pendingTarget = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        // barras de status e navegação pretas, ícones claros
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.BLACK),
            navigationBarStyle = SystemBarStyle.dark(Color.BLACK),
        )
        super.onCreate(savedInstanceState)
        applySecureFlag(prefs.config.value.secureScreen)
        pendingTarget.value = intent?.getStringExtra(Notifications.EXTRA_TARGET)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { prefs.config.collect { applySecureFlag(it.secureScreen) } }
                launch {
                    push.ensureRegistered()
                    // com o app aberto e sem FCM, consulta a outbox com frequência
                    while (true) {
                        delay(20_000)
                        push.pollNow()
                    }
                }
            }
        }

        setContent {
            OttoTheme {
                val config by prefs.config.collectAsStateWithLifecycle()
                val locked by lock.locked.collectAsStateWithLifecycle()
                val target by pendingTarget.collectAsStateWithLifecycle()
                var lockMessage by remember { mutableStateOf<String?>(null) }
                val nav = rememberNavController()

                Box(Modifier.fillMaxSize().background(OttoColors.Bg)) {
                    OttoNavHost(nav, configured = config.isConfigured, pendingTarget = if (locked) null else target, onTargetConsumed = { pendingTarget.value = null })
                    InAppBanner(onOpen = { t -> pendingTarget.value = t })
                    if (locked && config.biometricEnabled && config.isConfigured) {
                        LockScreen(lockMessage) { lock.prompt(this@MainActivity) { lockMessage = it } }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(Notifications.EXTRA_TARGET)?.let { pendingTarget.value = it }
    }

    /** FLAG_SECURE: bloqueia capturas e esconde a prévia em "Recentes". */
    private fun applySecureFlag(secure: Boolean) {
        if (secure) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!secure)
    }
}

/** Notificação recebida com o app aberto: cartão no topo por alguns segundos. */
@androidx.compose.runtime.Composable
private fun InAppBanner(onOpen: (String) -> Unit) {
    var current by remember { mutableStateOf<NotificationDto?>(null) }
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        Notifications.inApp.collect { n ->
            current = n
            visible = true
            delay(4_000)
            visible = false
        }
    }
    Box(Modifier.fillMaxSize()) {
        AnimatedVisibility(
            visible = visible,
            enter = fadeIn(tween(200)) + slideInVertically(tween(220)) { -it / 3 },
            exit = fadeOut(tween(200)) + slideOutVertically(tween(220)) { -it / 3 },
            modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(horizontal = ScreenPadding, vertical = 8.dp),
        ) {
            current?.let { n ->
                NotificationCard(n.title, n.body, onClick = {
                    visible = false
                    onOpen(n.target)
                })
            }
        }
    }
}
