package app.otto.ui

import android.net.Uri
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
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
import app.otto.ui.components.Motion
import app.otto.ui.home.HomeScreen
import app.otto.ui.settings.SettingsScreen
import app.otto.ui.auth.AuthScreen
import app.otto.ui.connect.ConnectScreen
import app.otto.ui.transactions.TransactionsScreen

object Routes {
    const val AUTH = "auth"
    const val CONNECT = "connect"
    const val HOME = "home"
    const val CHAT = "chat?q={q}"
    const val TRANSACTIONS = "transactions"
    const val SETTINGS = "settings"
    fun chat(q: String?) = if (q.isNullOrBlank()) "chat" else "chat?q=${Uri.encode(q)}"
}

private const val ANIM_MS = 220

@Composable
fun OttoNavHost(nav: NavHostController, signedIn: Boolean, bankConnected: Boolean, pendingTarget: String?, onTargetConsumed: () -> Unit) {
    // definido uma vez; depois a navegação é explícita (entrar, conectar o banco, sair)
    val start = remember { if (!signedIn) Routes.AUTH else if (!bankConnected) Routes.CONNECT else Routes.HOME }
    NavHost(
        navController = nav,
        startDestination = start,
        enterTransition = { fadeIn(tween(360, delayMillis = 60)) + slideInHorizontally(tween(440, easing = Motion.Emphasized)) { it / 5 } + scaleIn(tween(440, easing = Motion.Emphasized), initialScale = 0.94f) },
        exitTransition = { fadeOut(tween(220)) + slideOutHorizontally(tween(440, easing = Motion.Emphasized)) { -it / 8 } + scaleOut(tween(440, easing = Motion.Emphasized), targetScale = 0.96f) },
        popEnterTransition = { fadeIn(tween(320, delayMillis = 40)) + slideInHorizontally(tween(440, easing = Motion.Emphasized)) { -it / 8 } + scaleIn(tween(440, easing = Motion.Emphasized), initialScale = 0.96f) },
        popExitTransition = { fadeOut(tween(240)) + slideOutHorizontally(tween(440, easing = Motion.Emphasized)) { it / 5 } + scaleOut(tween(440, easing = Motion.Emphasized), targetScale = 0.94f) },
    ) {
        composable(Routes.AUTH) {
            AuthScreen(onDone = {
                nav.navigate(Routes.CONNECT) { popUpTo(0) { inclusive = true } }
            })
        }
        composable(Routes.CONNECT) {
            ConnectScreen(onDone = {
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
                onBankDisconnected = { nav.navigate(Routes.CONNECT) { popUpTo(0) { inclusive = true } } },
            )
        }
    }

    // sessão encerrada (sair, conta excluída ou 401 do servidor): volta para a tela de entrada
    LaunchedEffect(signedIn) {
        if (!signedIn && nav.currentDestination?.route != Routes.AUTH) {
            nav.navigate(Routes.AUTH) { popUpTo(0) { inclusive = true } }
        }
    }

    // toque numa notificação: abre a tela certa
    LaunchedEffect(pendingTarget, signedIn, bankConnected) {
        val target = pendingTarget ?: return@LaunchedEffect
        if (signedIn && bankConnected) {
            when (target) {
                "settings" -> nav.navigate(Routes.SETTINGS) { launchSingleTop = true }
                "transactions" -> nav.navigate(Routes.TRANSACTIONS) { launchSingleTop = true }
                else -> nav.popBackStack(Routes.HOME, inclusive = false)
            }
        }
        onTargetConsumed()
    }
}
