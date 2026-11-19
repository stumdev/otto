package app.otto.ui.setup

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import app.otto.data.LocalNetwork
import app.otto.ui.components.PrimaryButton
import app.otto.ui.components.ScreenPadding
import app.otto.ui.components.SecondaryButton
import app.otto.ui.components.OttoIcons
import app.otto.ui.components.OttoMark
import app.otto.ui.components.OttoTextField
import app.otto.ui.theme.OttoColors
import app.otto.ui.theme.OttoType
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

@Composable
fun SetupScreen(onDone: () -> Unit, vm: SetupViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(state.done) { if (state.done) onDone() }

    // Android 17+: servidor na rede local exige a permissão ACCESS_LOCAL_NETWORK
    val localNetLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.connect() else vm.localNetworkDenied()
    }
    val connect = {
        if (LocalNetwork.needsPermission(context, vm.state.value.url)) localNetLauncher.launch(LocalNetwork.PERMISSION)
        else vm.connect()
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(OttoColors.Bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = ScreenPadding, vertical = 32.dp),
    ) {
        OttoMark(64.dp)
        Spacer(Modifier.height(24.dp))
        Text("otto", style = OttoType.Wordmark, color = OttoColors.Text, modifier = Modifier.semantics { heading() })
        Text("seu dinheiro, em tempo real", style = OttoType.Body, color = OttoColors.Text2)
        Spacer(Modifier.height(40.dp))

        OttoTextField(
            value = state.url,
            onValueChange = vm::setUrl,
            label = "Endereço do servidor",
            placeholder = "https://otto.seudominio.com",
            keyboardType = KeyboardType.Uri,
        )
        Spacer(Modifier.height(16.dp))
        OttoTextField(
            value = state.token,
            onValueChange = vm::setToken,
            label = "Token de acesso",
            placeholder = "APP_TOKEN do servidor",
            password = true,
            imeAction = ImeAction.Go,
            onDone = { connect() },
        )
        state.error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, style = OttoType.Caption, color = OttoColors.Text, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
        }
        Spacer(Modifier.height(24.dp))
        PrimaryButton(if (state.connecting) "Conectando…" else "Conectar", onClick = { connect() }, enabled = !state.connecting)
        Spacer(Modifier.height(12.dp))
        SecondaryButton(
            "Ler QR code",
            icon = OttoIcons.Qr,
            enabled = !state.connecting,
            onClick = {
                // leitor do Google Play Services: não precisa de permissão de câmera no app
                val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
                GmsBarcodeScanning.getClient(context, options).startScan()
                    .addOnSuccessListener { code -> if (code.rawValue?.let(vm::applyQr) == true) connect() }
            },
        )
        Spacer(Modifier.height(24.dp))
        Text(
            "O token fica guardado cifrado neste aparelho (Android Keystore). O Otto nunca pede a senha do seu banco.",
            style = OttoType.Small,
            color = OttoColors.Text2,
        )
    }
}
