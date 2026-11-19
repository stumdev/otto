package app.otto.data

import kotlinx.serialization.Serializable

@Serializable
data class PublicConfig(
    val mode: String = "real",
    val signupCodeRequired: Boolean = false,
    val version: String = "",
)

@Serializable
data class RegisterBody(
    val email: String,
    val password: String,
    val name: String? = null,
    val signupCode: String? = null,
)

@Serializable
data class LoginBody(val email: String, val password: String)

@Serializable
data class SessionUser(val id: String, val email: String, val name: String? = null)

@Serializable
data class SessionResponse(val token: String, val user: SessionUser)

@Serializable
data class ConnectionItem(
    val itemId: String,
    val kind: String = "pluggy",
    val connector: String? = null,
)

@Serializable
data class ConnectionInfo(
    val connected: Boolean,
    val mode: String = "real",
    val items: List<ConnectionItem> = emptyList(),
)

/** `mock = true`: o servidor está em modo demonstração e não há widget de banco. */
@Serializable
data class ConnectTokenResponse(val mock: Boolean = false, val connectToken: String? = null)

@Serializable
data class ConnectItemBody(val itemId: String? = null)

@Serializable
data class ConnectItemResponse(
    val connected: Boolean = true,
    val synced: Boolean = false,
    val connector: String? = null,
)

@Serializable
data class DeleteAccountBody(val password: String)
