package app.otto.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.otto.ui.theme.OttoColors

/** Linha branca de 2dp, sem eixos, com o ponto final destacado. */
@Composable
fun Sparkline(values: List<Long>, description: String, modifier: Modifier = Modifier) {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(values) {
        progress.snapTo(0f)
        progress.animateTo(1f, tween(1100, easing = Motion.Emphasized))
    }
    Canvas(modifier.semantics { contentDescription = description }) {
        if (values.size < 2) return@Canvas
        val min = values.min()
        val max = values.max()
        val range = (max - min).takeIf { it > 0 } ?: 1L
        val pad = 6.dp.toPx()
        val w = size.width - pad * 2
        val h = size.height - pad * 2
        val pts = values.mapIndexed { i, v ->
            val x = pad + w * i / (values.size - 1)
            val y = if (max == min) pad + h / 2 else pad + h * (1f - (v - min).toFloat() / range)
            Offset(x, y)
        }
        val path = Path().apply {
            moveTo(pts[0].x, pts[0].y)
            for (i in 1 until pts.size) {
                // curva suave entre os pontos
                val p0 = pts[i - 1]
                val p1 = pts[i]
                val cx = (p0.x + p1.x) / 2
                cubicTo(cx, p0.y, cx, p1.y, p1.x, p1.y)
            }
        }
        clipRect(right = pad + w * progress.value + 2.dp.toPx()) {
            drawPath(path, OttoColors.Text, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
        // ponto final surge quando a linha termina de se desenhar
        val dot = ((progress.value - 0.85f) / 0.15f).coerceIn(0f, 1f)
        val end = pts.last()
        drawCircle(OttoColors.Bg, radius = 6.dp.toPx() * dot, center = end)
        drawCircle(OttoColors.Text, radius = 4.dp.toPx() * dot, center = end)
    }
}
