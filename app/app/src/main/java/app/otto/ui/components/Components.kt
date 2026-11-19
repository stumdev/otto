package app.otto.ui.components

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.otto.R
import app.otto.data.Money
import app.otto.ui.theme.OttoColors
import app.otto.ui.theme.OttoType

val CardShape = RoundedCornerShape(20.dp)
val PillShape = RoundedCornerShape(percent = 50)

/** Margem lateral padrão das telas. */
val ScreenPadding = 24.dp

/** Marca: quadrado arredondado (raio ≈ 30% do lado) com o "O" (e o ponto). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun OttoMark(size: Dp, modifier: Modifier = Modifier, dark: Boolean = false, onLongPress: (() -> Unit)? = null) {
    val shape = RoundedCornerShape(size * 0.3f)
    val base = modifier
        .size(size)
        .clip(shape)
        .background(if (dark) OttoColors.Surface else OttoColors.Text)
        .then(if (dark) Modifier.border(1.dp, OttoColors.BorderMark, shape) else Modifier)
    val interactive = if (onLongPress != null) {
        base.combinedClickable(onClick = {}, onLongClick = onLongPress, onLongClickLabel = "Simular Pix")
    } else {
        base
    }
    Box(interactive.semantics { contentDescription = "Otto" }, contentAlignment = Alignment.Center) {
        Icon(
            painter = painterResource(R.drawable.otto_mark),
            contentDescription = null,
            tint = if (dark) OttoColors.Text else OttoColors.OnPrimary,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/** Botão circular com borda (48dp: alvo de toque acessível). */
@Composable
fun CircleIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
    enabled: Boolean = true,
    size: Dp = 48.dp,
) {
    val bg = if (filled) OttoColors.Text else Color.Transparent
    val fg = if (filled) OttoColors.OnPrimary else OttoColors.Text
    val enabledAlpha by animateFloatAsState(if (enabled) 1f else 0.4f, tween(200), label = "enabled")
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(bg)
            .then(if (filled) Modifier else Modifier.border(1.dp, OttoColors.Border2, CircleShape))
            .alpha(enabledAlpha)
            .bounceClick(enabled = enabled, onClick = onClick)
            .semantics { this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(20.dp))
    }
}

@Composable
fun OttoCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(18.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .clip(CardShape)
            .background(OttoColors.Surface)
            .border(1.dp, OttoColors.Border, CardShape)
            .padding(padding),
        content = content,
    )
}

/** Valor com sinal sempre junto (não depende só da cor). */
@Composable
fun AmountText(cents: Long, style: TextStyle, modifier: Modifier = Modifier, signed: Boolean = true) {
    Text(
        text = if (signed) Money.signed(cents) else Money.brl(cents),
        style = style,
        color = if (cents < 0) OttoColors.Out else OttoColors.In,
        modifier = modifier,
        maxLines = 1,
    )
}

@Composable
fun Avatar(name: String, modifier: Modifier = Modifier) {
    val initial = name.trim().firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "•"
    Box(
        modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(OttoColors.Elevated)
            .border(1.dp, OttoColors.Border2, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(initial, style = OttoType.BodyMedium, color = OttoColors.Text)
    }
}

@Composable
fun TxRow(title: String, subtitle: String, amountCents: Long, modifier: Modifier = Modifier) {
    val kind = if (amountCents >= 0) "Entrada" else "Saída"
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = "$kind de ${Money.brl(amountCents)}, $title, $subtitle"
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(title)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = OttoType.BodyMedium, color = OttoColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Text(subtitle, style = OttoType.Caption, color = OttoColors.Text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(12.dp))
        AmountText(amountCents, OttoType.BodyMedium)
    }
}

/** Bloco de carregamento escuro com pulsação discreta. */
@Composable
fun Skeleton(modifier: Modifier = Modifier, shape: RoundedCornerShape = RoundedCornerShape(10.dp)) {
    val t = rememberInfiniteTransition(label = "skeleton")
    val x by t.animateFloat(-400f, 1400f, infiniteRepeatable(tween(1400, easing = LinearEasing)), label = "shimmer")
    val brush = Brush.linearGradient(
        colors = listOf(OttoColors.Elevated, OttoColors.Border2, OttoColors.Elevated),
        start = Offset(x, 0f),
        end = Offset(x + 420f, 120f),
    )
    Box(
        modifier
            .clip(shape)
            .background(brush),
    )
}

/** "● Atualizado agora" */
@Composable
fun StatusLine(text: String, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(6.dp)
                .clip(CircleShape)
                .background(OttoColors.Text),
        )
        Spacer(Modifier.width(8.dp))
        Text(text, style = OttoType.Small, color = OttoColors.Text2)
    }
}

@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = OttoType.Section, color = OttoColors.Text, modifier = Modifier.weight(1f).semantics { heading() })
        if (action != null && onAction != null) {
            Box(
                Modifier
                    .heightIn(min = 48.dp)
                    .clip(PillShape)
                    .bounceClick(onClick = onAction)
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(action, style = OttoType.Label, color = OttoColors.Text2)
            }
        }
    }
}

/** Campo "Pergunte ao Otto…" (pill 56dp) com botão de enviar circular branco. */
@Composable
fun AskField(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    placeholder: String = "Pergunte ao Otto…",
) {
    val canSend = enabled && value.isNotBlank()
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(PillShape)
            .background(OttoColors.Surface)
            .border(1.dp, OttoColors.Border2, PillShape)
            .padding(start = 20.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text(placeholder, style = OttoType.Body, color = OttoColors.Text2)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                textStyle = OttoType.Body.copy(color = OttoColors.Text),
                cursorBrush = SolidColor(OttoColors.Text),
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { if (canSend) onSend() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = placeholder },
            )
        }
        Spacer(Modifier.width(8.dp))
        CircleIconButton(OttoIcons.ArrowUp, "Enviar", onClick = onSend, filled = true, enabled = canSend, size = 44.dp)
    }
}

@Composable
fun Chip(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Box(
        modifier
            .heightIn(min = 40.dp)
            .clip(PillShape)
            .border(1.dp, OttoColors.Border2, PillShape)
            .bounceClick(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = OttoType.Caption, color = if (enabled) OttoColors.Text else OttoColors.Text2)
    }
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(PillShape)
            .background(if (enabled) OttoColors.Text else OttoColors.Elevated)
            .bounceClick(enabled = enabled, pressedScale = 0.97f, onClick = onClick)
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = OttoType.BodyMedium, color = if (enabled) OttoColors.OnPrimary else OttoColors.Text2)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(PillShape)
            .border(1.dp, OttoColors.Border2, PillShape)
            .bounceClick(enabled = enabled, pressedScale = 0.97f, onClick = onClick)
            .padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = OttoColors.Text, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
        }
        Text(text, style = OttoType.BodyMedium, color = if (enabled) OttoColors.Text else OttoColors.Text2)
    }
}

/** Campo de texto pill no estilo do app. */
@Composable
fun OttoTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    onDone: (() -> Unit)? = null,
) {
    Column(modifier.fillMaxWidth()) {
        Text(label, style = OttoType.Caption, color = OttoColors.Text2, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .clip(PillShape)
                .background(OttoColors.Surface)
                .border(1.dp, OttoColors.Border2, PillShape)
                .padding(horizontal = 20.dp, vertical = 14.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, style = OttoType.Body, color = OttoColors.Text2)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = OttoType.Body.copy(color = OttoColors.Text),
                cursorBrush = SolidColor(OttoColors.Text),
                visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions = KeyboardOptions(
                    keyboardType = if (password) KeyboardType.Password else keyboardType,
                    imeAction = imeAction,
                    autoCorrectEnabled = false,
                ),
                keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }, onGo = { onDone?.invoke() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = label },
            )
        }
    }
}

/** Ícone num círculo suave, usado nas linhas dos Ajustes. */
@Composable
fun RowIcon(icon: ImageVector, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(OttoColors.Elevated),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = OttoColors.Text, modifier = Modifier.size(18.dp))
    }
}

@Composable
fun ToggleRow(
    title: String,
    subtitle: String?,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .bounceClick(role = Role.Switch, pressedScale = 0.985f) { onChange(!checked) }
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            RowIcon(icon)
            Spacer(Modifier.width(14.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = OttoType.Body, color = OttoColors.Text)
            if (subtitle != null) Text(subtitle, style = OttoType.Caption, color = OttoColors.Text2)
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedThumbColor = OttoColors.OnPrimary,
                checkedTrackColor = OttoColors.Text,
                checkedBorderColor = OttoColors.Text,
                uncheckedThumbColor = OttoColors.Text2,
                uncheckedTrackColor = OttoColors.Bg,
                uncheckedBorderColor = OttoColors.Border2,
            ),
        )
    }
}

/** Linha de ajuste clicável: ícone, título, descrição, valor atual e chevron. */
@Composable
fun ValueRow(
    title: String,
    value: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    icon: ImageVector? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .bounceClick(pressedScale = 0.985f, onClick = onClick)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            RowIcon(icon)
            Spacer(Modifier.width(14.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = OttoType.Body, color = OttoColors.Text)
            if (subtitle != null) Text(subtitle, style = OttoType.Caption, color = OttoColors.Text2)
        }
        if (value.isNotEmpty()) {
            Spacer(Modifier.width(8.dp))
            Text(value, style = OttoType.Body, color = OttoColors.Text2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 150.dp))
        }
        Spacer(Modifier.width(8.dp))
        Icon(OttoIcons.ChevronRight, contentDescription = null, tint = OttoColors.Text2, modifier = Modifier.size(18.dp))
    }
}

@Composable
fun MessageState(title: String, body: String?, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = OttoType.Section, color = OttoColors.Text)
        if (body != null) {
            Spacer(Modifier.height(6.dp))
            Text(body, style = OttoType.Caption, color = OttoColors.Text2)
        }
        if (action != null && onAction != null) {
            Spacer(Modifier.height(16.dp))
            Box(Modifier.width(180.dp)) { SecondaryButton(action, onAction) }
        }
    }
}

/** Banner interno com o visual das notificações do Otto (#141414, raio 24). */
@Composable
fun NotificationCard(title: String, body: String, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val shape = RoundedCornerShape(24.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(OttoColors.Elevated)
            .border(1.dp, OttoColors.Border, shape)
            .then(if (onClick != null) Modifier.bounceClick(pressedScale = 0.98f, onClick = onClick) else Modifier)
            .padding(16.dp)
            .semantics(mergeDescendants = true) {},
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OttoMark(20.dp)
            Spacer(Modifier.width(8.dp))
            Text("Otto · agora", style = OttoType.Small, color = OttoColors.Text2)
        }
        Spacer(Modifier.height(10.dp))
        Text(title, style = OttoType.Title, color = OttoColors.Text)
        Spacer(Modifier.height(2.dp))
        Text(body, style = OttoType.Label, color = OttoColors.Text3)
    }
}

@Composable
fun BoxScope.FullScreenCenter(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.align(Alignment.Center).padding(ScreenPadding), horizontalAlignment = Alignment.CenterHorizontally, content = content)
}

/** **negrito** em markdown -> SpanStyle. O resto do texto fica como está. */
fun richText(text: String): AnnotatedString = buildAnnotatedString {
    val regex = Regex("""\*\*(.+?)\*\*""")
    var last = 0
    for (m in regex.findAll(text)) {
        append(text.substring(last, m.range.first))
        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(m.groupValues[1]) }
        last = m.range.last + 1
    }
    append(text.substring(last))
}

/** Haptic sutil (confirmação) ao enviar. */
@Composable
fun rememberHaptic(): () -> Unit {
    val view = LocalView.current
    return {
        view.performHapticFeedback(
            if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.KEYBOARD_TAP,
        )
    }
}
