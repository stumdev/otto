package app.tony.data

import app.tony.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

object Network {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = false
        classDiscriminator = "type"
    }

    /**
     * Valida e normaliza a URL do servidor. Em release, só https.
     * Retorna null se for inválida.
     */
    fun normalizeBaseUrl(raw: String): HttpUrl? {
        val trimmed = raw.trim().trimEnd('/')
        val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "https://$trimmed"
        val url = "$withScheme/".toHttpUrlOrNull() ?: return null
        if (!BuildConfig.DEBUG && !url.isHttps) return null
        return url
    }

    /** Cliente base: sem log de corpo/cabeçalhos (nunca registrar token nem valores). */
    fun baseClient(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    fun authed(base: OkHttpClient, token: String, readTimeoutSec: Long = 30): OkHttpClient = base.newBuilder()
        .readTimeout(readTimeoutSec, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("Authorization", "Bearer $token")
                    .header("Accept", "application/json")
                    .build(),
            )
        }
        .build()

    fun api(client: OkHttpClient, baseUrl: HttpUrl): TonyApi = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(TonyApi::class.java)
}
