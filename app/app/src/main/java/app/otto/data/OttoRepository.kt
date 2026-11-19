package app.otto.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

sealed interface ChatStreamEvent {
    data class Meta(val meta: ChatMeta) : ChatStreamEvent
    data class Delta(val text: String) : ChatStreamEvent
    data class Card(val card: ChatCard) : ChatStreamEvent
    data class Error(val message: String) : ChatStreamEvent
    data object Done : ChatStreamEvent
}

/** Erro de conta com mensagem pronta para mostrar ao usuário. */
class AuthException(message: String) : Exception(message)

class NotConfiguredException : IllegalStateException("Sem sessão")

/** Mensagem do servidor ({"error": "..."}) quando houver; usada nas telas de conta. */
private fun HttpException.serverMessage(): String? = runCatching {
    val body = response()?.errorBody()?.string().orEmpty()
    Network.json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.contentOrNull
}.getOrNull()

/** Mensagem amigável (pt-BR) para qualquer falha de rede/servidor. */
fun Throwable.userMessage(): String = when (this) {
    is NotConfiguredException -> "Entre na sua conta para continuar."
    is HttpException -> when (code()) {
        401 -> "Sessão expirada. Entre de novo."
        404 -> "Recurso não encontrado no servidor."
        429 -> "Muitas tentativas. Tente em instantes."
        in 500..599 -> "O servidor teve um problema. Tente de novo."
        else -> serverMessage() ?: "Erro do servidor (${code()})."
    }
    is SerializationException -> "Resposta inesperada do servidor."
    is IOException -> "Sem conexão com o servidor."
    else -> "Algo deu errado. Tente de novo."
}

@Singleton
class OttoRepository @Inject constructor(private val prefs: AppPrefs) {

    private val base: OkHttpClient = Network.baseClient()

    private data class Cached(val url: HttpUrl, val token: String, val api: OttoApi, val slowApi: OttoApi, val sseClient: OkHttpClient)

    @Volatile
    private var cached: Cached? = null

    private fun serverUrl(): HttpUrl =
        prefs.config.value.serverUrl?.let { Network.normalizeBaseUrl(it) } ?: throw NotConfiguredException()

    private fun current(): Cached {
        val cfg = prefs.config.value
        val url = serverUrl()
        val token = cfg.token ?: throw NotConfiguredException()
        cached?.let { if (it.url == url && it.token == token) return it }
        // 401 = sessão encerrada no servidor: sai da conta aqui (só se ainda for esta mesma sessão)
        val onUnauthorized = { if (prefs.config.value.token == token) prefs.clearSession() }
        val client = Network.authed(base, token, onUnauthorized = onUnauthorized)
        val slow = Network.authed(base, token, readTimeoutSec = 150, onUnauthorized = onUnauthorized)
        val sse = Network.authed(base, token, readTimeoutSec = 90, onUnauthorized = onUnauthorized)
        return Cached(url, token, Network.api(client, url), Network.api(slow, url), sse).also { cached = it }
    }

    private suspend fun <T> call(block: suspend OttoApi.() -> T): T = withContext(Dispatchers.IO) { current().api.block() }

    // ----- conta -----

    private val publicApi: OttoApi by lazy { Network.api(base, serverUrl()) }

    /** O servidor exige código de convite para criar conta? Falha de rede = não sabemos (null). */
    suspend fun publicConfig(): PublicConfig? = withContext(Dispatchers.IO) { runCatching { publicApi.publicConfig() }.getOrNull() }

    suspend fun register(email: String, password: String, name: String?, signupCode: String?): Result<Unit> =
        authCall(email) { publicApi.register(RegisterBody(email.trim(), password, name?.trim()?.ifBlank { null }, signupCode?.trim()?.ifBlank { null })) }

    suspend fun login(email: String, password: String): Result<Unit> =
        authCall(email) { publicApi.login(LoginBody(email.trim(), password)) }

    private suspend fun authCall(email: String, block: suspend () -> SessionResponse): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val r = block()
            prefs.saveSession(r.token, r.user.email)
        }.recoverCatching { e -> throw if (e is HttpException) AuthException(e.serverMessage() ?: e.userMessage()) else e }
    }

    /** Encerra a sessão no servidor (se der) e neste aparelho. */
    suspend fun signOut() {
        runCatching { call { logout() } }
        prefs.clearSession()
    }

    /** Exclui a conta e todos os dados no servidor. Retorna a mensagem de erro, se houver. */
    suspend fun deleteAccount(password: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching { current().api.deleteAccount(DeleteAccountBody(password)); prefs.clearSession() }
            .recoverCatching { e -> throw if (e is HttpException) AuthException(e.serverMessage() ?: e.userMessage()) else e }
    }

    // ----- conexão com o banco -----

    suspend fun connection(): ConnectionInfo = call { connection() }.also { prefs.setBankConnected(it.connected) }
    suspend fun connectToken(): ConnectTokenResponse = call { connectToken() }

    /** Registra o item criado pelo widget (ou a conta de demonstração) e espera a primeira importação. */
    suspend fun connectItem(itemId: String?): ConnectItemResponse = withContext(Dispatchers.IO) {
        current().slowApi.connectItem(ConnectItemBody(itemId)).also { prefs.setBankConnected(true) }
    }

    suspend fun disconnectBank() {
        call { disconnectBank() }
        prefs.setBankConnected(false)
    }

    /** URL da página que hospeda o widget Pluggy Connect (o token vai no fragmento, que não vai ao servidor). */
    fun connectPageUrl(connectToken: String): String = serverUrl().resolve("connect")!!.toString() + "#token=" + connectToken

    suspend fun status() = call { status() }
    suspend fun summary() = call { summary() }
    suspend fun wallet() = call { wallet() }

    /** Define (1–31) ou remove (null) o dia de vencimento do cartão. */
    suspend fun setCardDueDay(day: Int?) = call {
        updateSettingsRaw(
            kotlinx.serialization.json.buildJsonObject {
                put("cardDueDay", day?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
            },
        )
    }
    suspend fun transactions(cursor: String?, limit: Int = 30) = call { transactions(cursor = cursor, limit = limit) }
    suspend fun sync() = call { sync() }
    suspend fun settings() = call { settings() }
    suspend fun updateSettings(patch: SettingsPatch) = call { updateSettings(patch) }
    suspend fun registerDevice(fid: String) = call { registerDevice(DeviceBody(fid)) }
    suspend fun testPush() = call { testPush() }
    suspend fun notifications(after: Long) = call { notifications(after) }
    suspend fun simulate(direction: String? = null) = call { simulate(SimulateBody(direction = direction)) }
    suspend fun bankNotification(body: BankEventBody) = call { bankNotification(body) }

    /** Chat em streaming (SSE). Cancelar a coleta fecha a conexão. */
    fun chat(turns: List<ChatTurnDto>): Flow<ChatStreamEvent> = callbackFlow {
        val c = current()
        val body = Network.json.encodeToString(ChatRequest.serializer(), ChatRequest(turns))
        val request = Request.Builder()
            .url(c.url.resolve("v1/chat")!!)
            .post(body.toRequestBody("application/json".toMediaType()))
            .header("Accept", "text/event-stream")
            .build()

        val listener = object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                val ev: ChatStreamEvent? = runCatching {
                    when (type) {
                        "meta" -> ChatStreamEvent.Meta(Network.json.decodeFromString(ChatMeta.serializer(), data))
                        "delta" -> ChatStreamEvent.Delta(Network.json.decodeFromString(ChatDelta.serializer(), data).text)
                        "card" -> ChatStreamEvent.Card(Network.json.decodeFromString(ChatCard.serializer(), data))
                        "error" -> ChatStreamEvent.Error(Network.json.decodeFromString(ChatError.serializer(), data).message)
                        "done" -> ChatStreamEvent.Done
                        else -> null
                    }
                }.getOrNull()
                if (ev != null) trySend(ev)
                if (ev is ChatStreamEvent.Done) close()
            }

            override fun onClosed(eventSource: EventSource) {
                close()
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                val msg = when {
                    response?.code == 401 -> "Sessão expirada. Entre de novo."
                    response?.code == 429 -> "Muitas perguntas seguidas. Espere um pouco."
                    response != null && !response.isSuccessful -> "O servidor respondeu com erro (${response.code})."
                    else -> (t ?: IOException()).userMessage()
                }
                trySend(ChatStreamEvent.Error(msg))
                close()
            }
        }
        val source = EventSources.createFactory(c.sseClient).newEventSource(request, listener)
        awaitClose { source.cancel() }
    }.flowOn(Dispatchers.IO)
}
