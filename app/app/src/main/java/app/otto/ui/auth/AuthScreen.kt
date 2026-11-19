package app.otto.ui.auth

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.otto.BuildConfig
import app.otto.data.LocalNetwork
import app.otto.ui.components.OttoMark
import app.otto.ui.components.bounceClick
import app.otto.ui.components.OttoTextField
import app.otto.ui.components.PrimaryButton
import app.otto.ui.components.ScreenPadding
import app.otto.ui.components.enterAnimation
import app.otto.ui.theme.OttoColors
import app.otto.ui.theme.OttoType

/** Criar conta / entrar. O endereço do servidor já vem embutido no app: o usuário só informa e-mail e senha. */
@Composable
fun AuthScreen(onDone: () -> Unit, vm: AuthViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(state.done) { if (state.done) onDone() }

    // Android 17+: só quando o servidor está na rede local (desenvolvimento). Servidor público não pede nada.
    val localNetLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.submit() else vm.localNetworkDenied()
    }
    val submit = {
        if (LocalNetwork.needsPermission(context, BuildConfig.SERVER_URL)) localNetLauncher.launch(LocalNetwork.PERMISSION)
        else vm.submit()
    }
    val codeStep = state.signup

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
        OttoMark(64.dp, Modifier.enterAnimation(0))
        Spacer(Modifier.height(24.dp))
        Text("otto", style = OttoType.Wordmark, color = OttoColors.Text, modifier = Modifier.enterAnimation(1).semantics { heading() })
        Text("seu dinheiro, em tempo real", style = OttoType.Body, color = OttoColors.Text2, modifier = Modifier.enterAnimation(2))
        Spacer(Modifier.height(36.dp))

        Text(
            if (state.signup) "Crie sua conta" else "Entre na sua conta",
            style = OttoType.Title,
            color = OttoColors.Text,
            modifier = Modifier.enterAnimation(3).semantics { heading() },
        )
        Spacer(Modifier.height(20.dp))

        if (state.signup) {
            OttoTextField(value = state.name, onValueChange = vm::setName, label = "Nome (opcional)", placeholder = "Como podemos te chamar?")
            Spacer(Modifier.height(16.dp))
        }
        OttoTextField(
            value = state.email,
            onValueChange = vm::setEmail,
            label = "E-mail",
            placeholder = "voce@email.com",
            keyboardType = KeyboardType.Email,
            modifier = Modifier.enterAnimation(4),
        )
        Spacer(Modifier.height(16.dp))
        OttoTextField(
            value = state.password,
            onValueChange = vm::setPassword,
            label = "Senha",
            placeholder = if (state.signup) "Mínimo de 8 caracteres" else "Sua senha",
            password = true,
            imeAction = if (codeStep) ImeAction.Next else ImeAction.Go,
            onDone = { if (!codeStep) submit() },
            modifier = Modifier.enterAnimation(5),
        )
        if (codeStep) {
            Spacer(Modifier.height(16.dp))
            OttoTextField(
                value = state.signupCode,
                onValueChange = vm::setSignupCode,
                label = if (state.signupCodeRequired) "Código de convite" else "Código de convite (se tiver)",
                imeAction = ImeAction.Go,
                onDone = { submit() },
            )
        }
        state.error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, style = OttoType.Caption, color = OttoColors.Text, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
        }
        Spacer(Modifier.height(24.dp))
        PrimaryButton(
            when {
                state.busy -> "Aguarde…"
                state.signup -> "Criar conta"
                else -> "Entrar"
            },
            onClick = { submit() },
            enabled = !state.busy,
            modifier = Modifier.enterAnimation(6),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            if (state.signup) "Já tem conta? Entrar" else "Ainda não tem conta? Criar conta",
            style = OttoType.Caption,
            color = OttoColors.Text,
            modifier = Modifier
                .bounceClick { vm.setSignup(!state.signup) }
                .padding(vertical = 12.dp),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            "O Otto nunca pede a senha do seu banco: a conexão com o Nubank é feita pelo Open Finance, com a sua autorização.",
            style = OttoType.Small,
            color = OttoColors.Text2,
        )
    }
}
