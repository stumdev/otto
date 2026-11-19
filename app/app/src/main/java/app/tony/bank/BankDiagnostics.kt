package app.tony.bank

import android.content.Context
import app.tony.data.Network
import app.tony.data.SecureStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

@Serializable
data class UnrecognizedNotification(val at: Long, val title: String, val text: String, val reason: String)

@Serializable
data class BankStats(val recognized: Int = 0, val lastRecognizedAt: Long = 0, val lastSummary: String = "")

/**
 * Diagnóstico local da leitura de notificações do banco, cifrado com a chave do Keystore.
 * Guarda as últimas 20 notificações com valor em R$ que o parser NÃO reconheceu, para você
 * conferir/copiar e ajustar as regras. Nada disso sai do aparelho.
 */
@Singleton
class BankDiagnostics @Inject constructor(
    @ApplicationContext context: Context,
    private val secure: SecureStore,
) {
    private val file = File(context.filesDir, "bank_unrecognized.bin")
    private val statsFile = File(context.filesDir, "bank_stats.bin")
    private val listSer = ListSerializer(UnrecognizedNotification.serializer())

    private val _unrecognized = MutableStateFlow(loadList())
    val unrecognized: StateFlow<List<UnrecognizedNotification>> = _unrecognized.asStateFlow()

    private val _stats = MutableStateFlow(loadStats())
    val stats: StateFlow<BankStats> = _stats.asStateFlow()

    private fun loadList(): List<UnrecognizedNotification> = runCatching {
        if (!file.exists()) emptyList()
        else Network.json.decodeFromString(listSer, secure.decrypt(file.readBytes()).toString(Charsets.UTF_8))
    }.getOrDefault(emptyList())

    private fun loadStats(): BankStats = runCatching {
        if (!statsFile.exists()) BankStats()
        else Network.json.decodeFromString(BankStats.serializer(), secure.decrypt(statsFile.readBytes()).toString(Charsets.UTF_8))
    }.getOrDefault(BankStats())

    @Synchronized
    fun recordUnrecognized(title: String, text: String, reason: String) {
        val next = (_unrecognized.value + UnrecognizedNotification(System.currentTimeMillis(), title, text, reason)).takeLast(20)
        _unrecognized.value = next
        runCatching { file.writeBytes(secure.encrypt(Network.json.encodeToString(listSer, next).toByteArray(Charsets.UTF_8))) }
    }

    @Synchronized
    fun recordRecognized(summary: String) {
        val s = _stats.value
        val next = BankStats(s.recognized + 1, System.currentTimeMillis(), summary)
        _stats.value = next
        runCatching { statsFile.writeBytes(secure.encrypt(Network.json.encodeToString(BankStats.serializer(), next).toByteArray(Charsets.UTF_8))) }
    }

    @Synchronized
    fun clear() {
        _unrecognized.value = emptyList()
        file.delete()
    }

    /** Texto para copiar e colar (para ajustar o parser). */
    fun exportText(): String = _unrecognized.value.joinToString("\n\n") {
        "[${it.reason}]\nTítulo: ${it.title}\nTexto: ${it.text}"
    }
}
