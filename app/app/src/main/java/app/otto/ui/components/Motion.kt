package app.otto.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role

/** Curvas e tempos do app (um só lugar para o movimento ficar coerente). */
object Motion {
    const val ENTER_MS = 420
    const val STAGGER_MS = 55
    val Emphasized = FastOutSlowInEasing
}

/**
 * Clique com "mola": ao tocar, o elemento afunda levemente e volta com um pequeno rebote.
 * Substitui o clickable comum nos botões, chips, linhas e cartões.
 */
fun Modifier.bounceClick(
    enabled: Boolean = true,
    role: Role? = Role.Button,
    pressedScale: Float = 0.96f,
    onClick: () -> Unit,
): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled) pressedScale else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
        label = "press",
    )
    val dim by animateFloatAsState(if (pressed && enabled) 0.82f else 1f, tween(110), label = "pressDim")
    this
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
            alpha = dim
        }
        .clickable(interactionSource = source, indication = null, enabled = enabled, role = role, onClick = onClick)
}

/**
 * Entrada suave: o elemento sobe 18dp e aparece com fade; [index] escalona a entrada
 * para listas e telas ganharem um ritmo (cascata) em vez de aparecerem de uma vez.
 */
fun Modifier.enterAnimation(index: Int = 0, offsetPx: Float = 54f): Modifier = composed {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        progress.animateTo(1f, tween(Motion.ENTER_MS, delayMillis = (index * Motion.STAGGER_MS).coerceAtMost(600), easing = Motion.Emphasized))
    }
    graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * offsetPx
    }
}

/** Valor em centavos que "rola" até o novo número (começa do zero na primeira vez). */
@Composable
fun rememberAnimatedCents(target: Long, durationMs: Int = 900): Long {
    var shown by remember { mutableLongStateOf(0L) }
    LaunchedEffect(target) {
        val start = shown
        val anim = Animatable(0f)
        anim.animateTo(1f, tween(durationMs, easing = Motion.Emphasized)) {
            shown = start + ((target - start) * value).toLong()
        }
        shown = target
    }
    return shown
}
