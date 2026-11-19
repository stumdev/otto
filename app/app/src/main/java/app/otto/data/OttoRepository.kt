package app.otto.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
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

class NotConfiguredException : IllegalStateException("Servidor não configurado")

/** Mensagem amigável (pt-BR) para qualquer falha de rede/servidor. */
fun Throwable.userMessage(): String = when (this) {
    is NotConfiguredException -> "Configure o servidor nos Ajustes."
    is HttpException -> when (code()) {
        401 -> "Token inválido. Confira nos Ajustes."
        404 -> "Recurso não encontrado no servidor."
        429 -> "Muitas requisições. Tente em instantes."
        in 500..599 -> "O servidor teve um problema. Tente de novo."
        else -> "Erro do servidor (${code()})."
    }
    is SerializationException -> "Resposta inesperada do servidor."
    is IOException -> "Sem conexão com o servidor."
    else -> "Algo deu errado. Tente de novo."
}

@Singleton
class OttoRepository @Inject constructor(private val prefs: AppPrefs) {

    private val base: OkHttpClient = Network.baseClient()

    private data class Cached(val url: HttpUrl, val token: String, val api: OttoApi, val sseClient: OkHttpClient)

    @Volatile
    private var cached: Cached? = null

    private fun current(): Cached {
        val cfg = prefs.config.value
        val url = cfg.serverUrl?.let { Network.normalizeBaseUrl(it) } ?: throw NotConfiguredException()
        val token = cfg.token ?: throw NotConfiguredException()
        cached?.let { if (it.url == url && it.token == token) return it }
        val client = Network.authed(base, token)
        val sse = Network.authed(base, token, readTimeoutSec = 90)
        return Cached(url, token, Network.api(client, url), sse).also { cached = it }
    }

    private suspend fun <T> call(block: suspend OttoApi.() -> T): T = withContext(Dispatchers.IO) { current().api.block() }

    /** Testa URL + token antes de salvar (tela de configuração). */
    suspend fun probe(rawUrl: String, token: String): Result<ServerStatus> = withContext(Dispatchers.IO) {
        runCatching {
            val url = Network.normalizeBaseUrl(rawUrl)
                ?: throw IllegalArgumentException("URL inválida. Em produção use https://")
            Network.api(Network.authed(base, token), url).status()
        }
    }

    suspend fun status() = call { status() }
    suspend fun summary() = call { summary() }
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
                    response?.code == 401 -> "Token inválido. Confira nos Ajustes."
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
