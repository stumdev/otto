package app.otto.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.otto.data.AuthException
import app.otto.data.OttoRepository
import app.otto.data.userMessage
import app.otto.notify.PushManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthState(
    val signup: Boolean = true,
    val name: String = "",
    val email: String = "",
    val password: String = "",
    val signupCode: String = "",
    val signupCodeRequired: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val done: Boolean = false,
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val repo: OttoRepository,
    private val push: PushManager,
) : ViewModel() {

    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            repo.publicConfig()?.let { c -> _state.update { it.copy(signupCodeRequired = c.signupCodeRequired) } }
        }
    }

    fun setSignup(v: Boolean) = _state.update { it.copy(signup = v, error = null) }
    fun setName(v: String) = _state.update { it.copy(name = v, error = null) }
    fun setEmail(v: String) = _state.update { it.copy(email = v, error = null) }
    fun setPassword(v: String) = _state.update { it.copy(password = v, error = null) }
    fun setSignupCode(v: String) = _state.update { it.copy(signupCode = v, error = null) }

    fun localNetworkDenied() = _state.update {
        it.copy(error = "Sem a permissão de rede local o Otto não alcança um servidor no seu Wi-Fi ou no emulador. Permita e tente de novo.")
    }

    fun submit() {
        val s = _state.value
        if (s.busy) return
        val email = s.email.trim()
        val problem = when {
            !EMAIL.matches(email) -> "Digite um e-mail válido."
            s.signup && s.password.length < 8 -> "A senha precisa ter pelo menos 8 caracteres."
            !s.signup && s.password.isEmpty() -> "Digite a senha."
            s.signup && s.signupCodeRequired && s.signupCode.isBlank() -> "Digite o código de convite."
            else -> null
        }
        if (problem != null) return _state.update { it.copy(error = problem) }

        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            val result = if (s.signup) repo.register(email, s.password, s.name, s.signupCode) else repo.login(email, s.password)
            result
                .onSuccess {
                    push.ensureRegistered()
                    _state.update { it.copy(busy = false, done = true, password = "") }
                }
                .onFailure { e ->
                    val msg = if (e is AuthException) e.message else e.userMessage()
                    _state.update { it.copy(busy = false, error = msg) }
                }
        }
    }

    private companion object {
        val EMAIL = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")
    }
}
