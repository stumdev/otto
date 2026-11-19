package app.tony.ui.lock

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.tony.ui.components.PrimaryButton
import app.tony.ui.components.ScreenPadding
import app.tony.ui.components.TonyMark
import app.tony.ui.theme.TonyColors
import app.tony.ui.theme.TonyType

/** Cobre todo o conteúdo até a autenticação. Pede a biometria assim que aparece. */
@Composable
fun LockScreen(message: String?, onUnlock: () -> Unit) {
    LaunchedEffect(Unit) { onUnlock() }
    Box(Modifier.fillMaxSize().background(TonyColors.Bg)) {
        Column(Modifier.align(Alignment.Center).padding(ScreenPadding), horizontalAlignment = Alignment.CenterHorizontally) {
            TonyMark(64.dp, dark = true)
            Spacer(Modifier.height(20.dp))
            Text("Tony está bloqueado", style = TonyType.Section, color = TonyColors.Text)
            if (message != null) {
                Spacer(Modifier.height(8.dp))
                Text(message, style = TonyType.Caption, color = TonyColors.Text2, textAlign = TextAlign.Center)
            }
        }
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(ScreenPadding)
                .width(240.dp),
        ) {
            PrimaryButton("Desbloquear", onClick = onUnlock)
        }
    }
}
