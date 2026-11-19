package app.otto.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

@Serializable
data class StoredMessage(
    val id: Long,
    val role: String, // "user" | "assistant"
    val text: String,
    val cards: List<ChatCard> = emptyList(),
    val offline: Boolean = false,
    val error: Boolean = false,
)

/** Histórico do chat salvo só no aparelho, cifrado com a chave do Keystore. */
@Singleton
class ChatStore @Inject constructor(
    @ApplicationContext context: Context,
    private val secure: SecureStore,
) {
    private val file = File(context.filesDir, "chat_history.bin")
    private val serializer = ListSerializer(StoredMessage.serializer())

    suspend fun load(): List<StoredMessage> = withContext(Dispatchers.IO) {
        if (!file.exists()) return@withContext emptyList()
        runCatching {
            val plain = secure.decrypt(file.readBytes()).toString(Charsets.UTF_8)
            Network.json.decodeFromString(serializer, plain)
        }.getOrDefault(emptyList())
    }

    suspend fun save(messages: List<StoredMessage>) = withContext(Dispatchers.IO) {
        val trimmed = messages.filterNot { it.error }.takeLast(MAX)
        val blob = secure.encrypt(Network.json.encodeToString(serializer, trimmed).toByteArray(Charsets.UTF_8))
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.writeBytes(blob)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    suspend fun clear() = withContext(Dispatchers.IO) { file.delete() }

    private companion object {
        const val MAX = 200
    }
}
