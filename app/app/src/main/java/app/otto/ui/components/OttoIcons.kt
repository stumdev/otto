package app.otto.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** Ícones de linha, monocromáticos (a cor vem do tint). Grade 24×24, traço 1,8. */
object OttoIcons {
    private fun icon(name: String, vararg paths: String): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            for (d in paths) {
                addPath(
                    pathData = addPathNodes(d),
                    fill = null,
                    stroke = SolidColor(Color.White),
                    strokeLineWidth = 1.8f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

    val Bell = icon("bell", "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.73 21a2 2 0 0 1-3.46 0")
    val ArrowUp = icon("arrow_up", "M12 19V5", "M5 12l7-7 7 7")
    val ArrowLeft = icon("arrow_left", "M19 12H5", "M12 19l-7-7 7-7")
    val ChevronRight = icon("chevron_right", "M9 18l6-6-6-6")
    val Sliders = icon(
        "sliders",
        "M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6",
    )
    val Close = icon("close", "M18 6L6 18", "M6 6l12 12")
    val Qr = icon("qr", "M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h2v2h-2z", "M18 18h2v2h-2z", "M18 14h2", "M14 18v2")
    val Lock = icon("lock", "M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4")
}
