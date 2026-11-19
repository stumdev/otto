package app.otto.ui.lock

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
import app.otto.ui.components.PrimaryButton
import app.otto.ui.components.ScreenPadding
import app.otto.ui.components.OttoMark
import app.otto.ui.theme.OttoColors
import app.otto.ui.theme.OttoType

/** Cobre todo o conteúdo até a autenticação. Pede a biometria assim que aparece. */
@Composable
fun LockScreen(message: String?, onUnlock: () -> Unit) {
    LaunchedEffect(Unit) { onUnlock() }
    Box(Modifier.fillMaxSize().background(OttoColors.Bg)) {
        Column(Modifier.align(Alignment.Center).padding(ScreenPadding), horizontalAlignment = Alignment.CenterHorizontally) {
            OttoMark(64.dp, dark = true)
            Spacer(Modifier.height(20.dp))
            Text("Otto está bloqueado", style = OttoType.Section, color = OttoColors.Text)
            if (message != null) {
                Spacer(Modifier.height(8.dp))
                Text(message, style = OttoType.Caption, color = OttoColors.Text2, textAlign = TextAlign.Center)
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
