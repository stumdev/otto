package app.tony.security

import android.os.SystemClock
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import app.tony.data.AppPrefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Bloqueio ao abrir o app (biometria ou PIN/padrão do aparelho).
 * Bloqueia na abertura e quando o app volta depois de [GRACE_MS] em segundo plano.
 */
@Singleton
class AppLock @Inject constructor(private val prefs: AppPrefs) : DefaultLifecycleObserver {

    private val _locked = MutableStateFlow(prefs.config.value.biometricEnabled)
    val locked: StateFlow<Boolean> = _locked.asStateFlow()

    private var backgroundAt: Long? = null

    fun install() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
    }

    override fun onStop(owner: LifecycleOwner) {
        backgroundAt = SystemClock.elapsedRealtime()
    }

    override fun onStart(owner: LifecycleOwner) {
        val since = backgroundAt?.let { SystemClock.elapsedRealtime() - it }
        if (prefs.config.value.biometricEnabled && since != null && since > GRACE_MS) _locked.value = true
    }

    fun unlock() {
        _locked.value = false
    }

    /** Quando o usuário desliga a opção nos Ajustes. */
    fun disable() {
        _locked.value = false
    }

    fun canAuthenticate(activity: FragmentActivity): Boolean =
        BiometricManager.from(activity).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

    fun prompt(activity: FragmentActivity, onError: (String) -> Unit) {
        if (!canAuthenticate(activity)) {
            // aparelho sem biometria nem bloqueio de tela: não há como verificar
            onError("Configure um bloqueio de tela no aparelho para usar esta proteção.")
            unlock()
            return
        }
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = unlock()

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (errorCode != BiometricPrompt.ERROR_USER_CANCELED &&
                        errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON &&
                        errorCode != BiometricPrompt.ERROR_CANCELED
                    ) {
                        onError(errString.toString())
                    }
                }
            },
        )
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Desbloquear o Tony")
                .setSubtitle("Confirme que é você")
                .setAllowedAuthenticators(AUTHENTICATORS)
                .build(),
        )
    }

    private companion object {
        const val GRACE_MS = 60_000L
        const val AUTHENTICATORS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL
    }
}
