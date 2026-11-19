package app.otto.ui.connect

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Message
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.otto.ui.components.CircleIconButton
import app.otto.ui.components.OttoCard
import app.otto.ui.components.OttoIcons
import app.otto.ui.components.OttoMark
import app.otto.ui.components.PrimaryButton
import app.otto.ui.components.ScreenPadding
import app.otto.ui.components.SecondaryButton
import app.otto.ui.theme.OttoColors
import app.otto.ui.theme.OttoType

/** Passo 2: conectar o Nubank (Open Finance, via Pluggy Connect). */
@Composable
fun ConnectScreen(onDone: () -> Unit, vm: ConnectViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.phase) { if (state.phase is ConnectPhase.Done) onDone() }

    when (val phase = state.phase) {
        is ConnectPhase.Widget -> WidgetScreen(
            url = phase.url,
            onConnected = vm::onWidgetConnected,
            onClosed = vm::onWidgetClosed,
            onError = vm::onWidgetError,
        )
        ConnectPhase.Checking, ConnectPhase.Importing, ConnectPhase.Done -> Box(
            Modifier.fillMaxSize().background(OttoColors.Bg).statusBarsPadding().navigationBarsPadding(),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(ScreenPadding)) {
                CircularProgressIndicator(color = OttoColors.Text, strokeWidth = 2.dp)
                Spacer(Modifier.height(20.dp))
                Text(
                    if (phase == ConnectPhase.Importing) "Importando suas movimentações…" else "Carregando…",
                    style = OttoType.Body,
                    color = OttoColors.Text,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                if (phase == ConnectPhase.Importing) {
                    Spacer(Modifier.height(8.dp))
                    Text("Isso pode levar até um minuto na primeira vez.", style = OttoType.Caption, color = OttoColors.Text2)
                }
            }
        }
        ConnectPhase.Intro -> Column(
            Modifier
                .fillMaxSize()
                .background(OttoColors.Bg)
                .statusBarsPadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = ScreenPadding, vertical = 32.dp),
        ) {
            OttoMark(64.dp)
            Spacer(Modifier.height(24.dp))
            Text(
                if (state.demo) "Vamos começar" else "Conecte seu Nubank",
                style = OttoType.Wordmark,
                color = OttoColors.Text,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(8.dp))
            Text(
                if (state.demo) {
                    "Este servidor está em modo de demonstração. Vamos criar uma conta de exemplo com movimentações fictícias."
                } else {
                    "Para mostrar seu saldo e avisar a cada movimentação, o Otto precisa da sua autorização pelo Open Finance."
                },
                style = OttoType.Body,
                color = OttoColors.Text2,
            )
            Spacer(Modifier.height(28.dp))
            OttoCard(Modifier.fillMaxWidth()) {
                Bullet("Você autoriza no app do próprio Nubank. O Otto nunca vê a senha do seu banco.")
                Spacer(Modifier.height(12.dp))
                Bullet("O acesso é só de leitura: o Otto não movimenta seu dinheiro.")
                Spacer(Modifier.height(12.dp))
                Bullet("Você pode desconectar e apagar seus dados quando quiser, nos Ajustes.")
            }
            state.error?.let {
                Spacer(Modifier.height(16.dp))
                Text(it, style = OttoType.Caption, color = OttoColors.Text, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
            }
            Spacer(Modifier.height(24.dp))
            PrimaryButton(
                when {
                    state.busy -> "Aguarde…"
                    state.demo -> "Usar conta de demonstração"
                    else -> "Conectar Nubank"
                },
                onClick = vm::start,
                enabled = !state.busy,
            )
            Spacer(Modifier.height(12.dp))
            SecondaryButton("Sair da conta", onClick = vm::signOut)
        }
    }
}

@Composable
private fun Bullet(text: String) {
    Row(verticalAlignment = Alignment.Top) {
        Text("•", style = OttoType.Body, color = OttoColors.Text)
        Spacer(Modifier.width(10.dp))
        Text(text, style = OttoType.Caption, color = OttoColors.Text2)
    }
}

/**
 * WebView com a página /connect do servidor (widget Pluggy Connect).
 * O resultado volta por redirecionamentos otto://connected | otto://error | otto://closed.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun WidgetScreen(url: String, onConnected: (String) -> Unit, onClosed: () -> Unit, onError: (String) -> Unit) {
    val context = LocalContext.current
    BackHandler(onBack = onClosed)

    Column(Modifier.fillMaxSize().background(OttoColors.Bg).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(OttoIcons.Close, "Cancelar", onClick = onClosed)
            Spacer(Modifier.width(12.dp))
            Text("Conectar Nubank", style = OttoType.ScreenTitle, color = OttoColors.Text, modifier = Modifier.semantics { heading() })
        }
        val holder = remember { mutableListOf<WebView>() }
        DisposableEffect(Unit) {
            onDispose {
                holder.firstOrNull()?.apply {
                    stopLoading()
                    loadUrl("about:blank")
                    clearHistory()
                    destroy()
                }
            }
        }
        AndroidView(
            modifier = Modifier.fillMaxWidth().weight(1f),
            factory = { ctx ->
                WebView(ctx).also { wv ->
                    holder.add(wv)
                    wv.setBackgroundColor(Color.BLACK)
                    wv.settings.javaScriptEnabled = true
                    wv.settings.domStorageEnabled = true
                    wv.isVerticalScrollBarEnabled = true
                    wv.overScrollMode = android.view.View.OVER_SCROLL_IF_CONTENT_SCROLLS
                    wv.settings.allowFileAccess = false
                    wv.settings.allowContentAccess = false
                    wv.settings.setSupportMultipleWindows(true)
                    wv.settings.javaScriptCanOpenWindowsAutomatically = true
                    // pop-ups do widget (autorização do banco) abrem fora da WebView
                    wv.webChromeClient = object : WebChromeClient() {
                        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                            val temp = WebView(view.context)
                            temp.webViewClient = object : WebViewClient() {
                                private var handled = false
                                private fun forward(uri: Uri) {
                                    if (handled || uri.toString() == "about:blank") return
                                    handled = true
                                    openExternal(view.context, uri)
                                    temp.post { temp.destroy() }
                                }
                                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                                    forward(request.url)
                                    return true
                                }
                                override fun onPageStarted(v: WebView, url: String, favicon: android.graphics.Bitmap?) {
                                    forward(Uri.parse(url))
                                }
                            }
                            (resultMsg.obj as WebView.WebViewTransport).webView = temp
                            resultMsg.sendToTarget()
                            return true
                        }
                    }
                    wv.webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val uri = request.url
                            when (uri.scheme) {
                                "otto" -> {
                                    when (uri.host) {
                                        "connected" -> uri.getQueryParameter("itemId")?.let(onConnected)
                                            ?: onError("Conexão sem identificador.")
                                        "closed" -> onClosed()
                                        else -> onError(uri.getQueryParameter("message") ?: "Não foi possível conectar.")
                                    }
                                    return true
                                }
                                "https", "http" -> return false
                                else -> {
                                    // intent://, nubank:// etc.: abre o app do banco para autorizar
                                    openExternal(ctx, uri)
                                    return true
                                }
                            }
                        }
                    }
                    wv.loadUrl(url)
                }
            },
        )
    }
}

private fun openExternal(context: android.content.Context, uri: Uri) {
    val intent = runCatching {
        if (uri.scheme == "intent") Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME) else Intent(Intent.ACTION_VIEW, uri)
    }.getOrNull() ?: return
    // não aceita intents que visem componentes arbitrários de outros apps
    intent.addCategory(Intent.CATEGORY_BROWSABLE)
    intent.component = null
    intent.selector = null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(intent) }
}
