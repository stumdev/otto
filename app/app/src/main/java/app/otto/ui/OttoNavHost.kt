package app.otto.ui

import android.net.Uri
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import app.otto.ui.chat.ChatScreen
import app.otto.ui.home.HomeScreen
import app.otto.ui.settings.SettingsScreen
import app.otto.ui.setup.SetupScreen
import app.otto.ui.transactions.TransactionsScreen

object Routes {
    const val SETUP = "setup"
    const val HOME = "home"
    const val CHAT = "chat?q={q}"
    const val TRANSACTIONS = "transactions"
    const val SETTINGS = "settings"
    fun chat(q: String?) = if (q.isNullOrBlank()) "chat" else "chat?q=${Uri.encode(q)}"
}

private const val ANIM_MS = 220

@Composable
fun OttoNavHost(nav: NavHostController, configured: Boolean, pendingTarget: String?, onTargetConsumed: () -> Unit) {
    // definido uma vez; depois a navegação é explícita (configurar/desconectar)
    val start = remember { if (configured) Routes.HOME else Routes.SETUP }
    NavHost(
        navController = nav,
        startDestination = start,
        enterTransition = { fadeIn(tween(ANIM_MS)) + slideInHorizontally(tween(ANIM_MS)) { it / 12 } },
        exitTransition = { fadeOut(tween(ANIM_MS)) },
        popEnterTransition = { fadeIn(tween(ANIM_MS)) },
        popExitTransition = { fadeOut(tween(ANIM_MS)) + slideOutHorizontally(tween(ANIM_MS)) { it / 12 } },
    ) {
        composable(Routes.SETUP) {
            SetupScreen(onDone = {
                nav.navigate(Routes.HOME) { popUpTo(0) { inclusive = true } }
            })
        }
        composable(Routes.HOME) {
            HomeScreen(
                onOpenChat = { q -> nav.navigate(Routes.chat(q)) },
                onOpenTransactions = { nav.navigate(Routes.TRANSACTIONS) },
                onOpenSettings = { nav.navigate(Routes.SETTINGS) },
            )
        }
        composable(
            Routes.CHAT,
            arguments = listOf(navArgument("q") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) {
            ChatScreen(onBack = { nav.popBackStack() })
        }
        composable(Routes.TRANSACTIONS) { TransactionsScreen(onBack = { nav.popBackStack() }) }
        composable(Routes.SETTINGS) {
            SettingsScreen(
                onBack = { nav.popBackStack() },
                onEditServer = { nav.navigate(Routes.SETUP) },
                onDisconnected = { nav.navigate(Routes.SETUP) { popUpTo(0) { inclusive = true } } },
            )
        }
    }

    // toque numa notificação: abre a tela certa
    LaunchedEffect(pendingTarget, configured) {
        val target = pendingTarget ?: return@LaunchedEffect
        if (configured) {
            when (target) {
                "settings" -> nav.navigate(Routes.SETTINGS) { launchSingleTop = true }
                "transactions" -> nav.navigate(Routes.TRANSACTIONS) { launchSingleTop = true }
                else -> nav.popBackStack(Routes.HOME, inclusive = false)
            }
        }
        onTargetConsumed()
    }
}
