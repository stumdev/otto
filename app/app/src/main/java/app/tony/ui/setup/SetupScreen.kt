package app.tony.ui.setup

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tony.ui.components.PrimaryButton
import app.tony.ui.components.ScreenPadding
import app.tony.ui.components.SecondaryButton
import app.tony.ui.components.TonyIcons
import app.tony.ui.components.TonyMark
import app.tony.ui.components.TonyTextField
import app.tony.ui.theme.TonyColors
import app.tony.ui.theme.TonyType
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

@Composable
fun SetupScreen(onDone: () -> Unit, vm: SetupViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(state.done) { if (state.done) onDone() }

    Column(
        Modifier
            .fillMaxSize()
            .background(TonyColors.Bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = ScreenPadding, vertical = 32.dp),
    ) {
        TonyMark(64.dp)
        Spacer(Modifier.height(24.dp))
        Text("tony", style = TonyType.Wordmark, color = TonyColors.Text, modifier = Modifier.semantics { heading() })
        Text("seu dinheiro, em tempo real", style = TonyType.Body, color = TonyColors.Text2)
        Spacer(Modifier.height(40.dp))

        TonyTextField(
            value = state.url,
            onValueChange = vm::setUrl,
            label = "Endereço do servidor",
            placeholder = "https://tony.seudominio.com",
            keyboardType = KeyboardType.Uri,
        )
        Spacer(Modifier.height(16.dp))
        TonyTextField(
            value = state.token,
            onValueChange = vm::setToken,
            label = "Token de acesso",
            placeholder = "APP_TOKEN do servidor",
            password = true,
            imeAction = ImeAction.Go,
            onDone = vm::connect,
        )
        state.error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, style = TonyType.Caption, color = TonyColors.Text, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
        }
        Spacer(Modifier.height(24.dp))
        PrimaryButton(if (state.connecting) "Conectando…" else "Conectar", onClick = vm::connect, enabled = !state.connecting)
        Spacer(Modifier.height(12.dp))
        SecondaryButton(
            "Ler QR code",
            icon = TonyIcons.Qr,
            enabled = !state.connecting,
            onClick = {
                // leitor do Google Play Services: não precisa de permissão de câmera no app
                val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
                GmsBarcodeScanning.getClient(context, options).startScan()
                    .addOnSuccessListener { code -> code.rawValue?.let(vm::applyQr) }
            },
        )
        Spacer(Modifier.height(24.dp))
        Text(
            "O token fica guardado cifrado neste aparelho (Android Keystore). O Tony nunca pede a senha do seu banco.",
            style = TonyType.Small,
            color = TonyColors.Text2,
        )
    }
}
