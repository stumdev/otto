package app.otto.data

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * Android 17 (API 37) bloqueia por padrão o acesso à rede local para apps com targetSdk 37
 * até o usuário conceder ACCESS_LOCAL_NETWORK
 * (https://developer.android.com/privacy-and-security/local-network-permission).
 * Só é necessário quando o servidor está num endereço local (emulador 10.0.2.2, Wi-Fi de casa,
 * VPN de rede privada). Um servidor público com HTTPS não precisa dessa permissão.
 */
object LocalNetwork {
    const val PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK"

    /** true se o host for loopback, privado, link-local, CGNAT/Tailscale ou um nome local. */
    fun isLocalHost(host: String): Boolean {
        val h = host.trim().trim('[', ']').lowercase()
        if (h.isEmpty()) return false
        if (h == "localhost" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home.arpa") || !h.contains('.') && !h.contains(':')) {
            return true
        }
        val v4 = h.split('.').takeIf { it.size == 4 }?.map { it.toIntOrNull() ?: return false }
        if (v4 != null) {
            if (v4.any { it !in 0..255 }) return false
            val (a, b) = v4[0] to v4[1]
            return a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) ||
                (a == 169 && b == 254) || (a == 100 && b in 64..127)
        }
        if (h.contains(':')) {
            return h == "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe8") ||
                h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")
        }
        return false
    }

    /** true quando é preciso pedir a permissão antes de falar com este servidor. */
    fun needsPermission(context: Context, rawUrl: String?): Boolean {
        if (Build.VERSION.SDK_INT < 37 || rawUrl.isNullOrBlank()) return false
        val host = Network.normalizeBaseUrl(rawUrl)?.host ?: return false
        if (!isLocalHost(host)) return false
        return ContextCompat.checkSelfPermission(context, PERMISSION) != PackageManager.PERMISSION_GRANTED
    }
}
