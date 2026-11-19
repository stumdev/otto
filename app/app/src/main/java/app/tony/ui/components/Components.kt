package app.tony.ui.components

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.RepeatMode
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
import app.tony.R
import app.tony.data.Money
import app.tony.ui.theme.TonyColors
import app.tony.ui.theme.TonyType

val CardShape = RoundedCornerShape(20.dp)
val PillShape = RoundedCornerShape(percent = 50)

/** Margem lateral padrão das telas. */
val ScreenPadding = 24.dp

/** Marca: quadrado arredondado (raio ≈ 30% do lado) com o "T". */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TonyMark(size: Dp, modifier: Modifier = Modifier, dark: Boolean = false, onLongPress: (() -> Unit)? = null) {
    val shape = RoundedCornerShape(size * 0.3f)
    val base = modifier
        .size(size)
        .clip(shape)
        .background(if (dark) TonyColors.Surface else TonyColors.Text)
        .then(if (dark) Modifier.border(1.dp, TonyColors.BorderMark, shape) else Modifier)
    val interactive = if (onLongPress != null) {
        base.combinedClickable(onClick = {}, onLongClick = onLongPress, onLongClickLabel = "Simular Pix")
    } else {
        base
    }
    Box(interactive.semantics { contentDescription = "Tony" }, contentAlignment = Alignment.Center) {
        Icon(
            painter = painterResource(R.drawable.tony_t),
            contentDescription = null,
            tint = if (dark) TonyColors.Text else TonyColors.OnPrimary,
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
    val bg = if (filled) TonyColors.Text else Color.Transparent
    val fg = if (filled) TonyColors.OnPrimary else TonyColors.Text
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(bg)
            .then(if (filled) Modifier else Modifier.border(1.dp, TonyColors.Border2, CircleShape))
            .alpha(if (enabled) 1f else 0.4f)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(20.dp))
    }
}

@Composable
fun TonyCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(18.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .clip(CardShape)
            .background(TonyColors.Surface)
            .border(1.dp, TonyColors.Border, CardShape)
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
        color = if (cents < 0) TonyColors.Out else TonyColors.In,
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
            .background(TonyColors.Elevated)
            .border(1.dp, TonyColors.Border2, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(initial, style = TonyType.BodyMedium, color = TonyColors.Text)
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
            Text(title, style = TonyType.BodyMedium, color = TonyColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Text(subtitle, style = TonyType.Caption, color = TonyColors.Text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(12.dp))
        AmountText(amountCents, TonyType.BodyMedium)
    }
}

/** Bloco de carregamento escuro com pulsação discreta. */
@Composable
fun Skeleton(modifier: Modifier = Modifier, shape: RoundedCornerShape = RoundedCornerShape(10.dp)) {
    val t = rememberInfiniteTransition(label = "skeleton")
    val a by t.animateFloat(0.55f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "alpha")
    Box(
        modifier
            .alpha(a)
            .clip(shape)
            .background(TonyColors.Elevated),
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
                .background(TonyColors.Text),
        )
        Spacer(Modifier.width(8.dp))
        Text(text, style = TonyType.Small, color = TonyColors.Text2)
    }
}

@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = TonyType.Section, color = TonyColors.Text, modifier = Modifier.weight(1f).semantics { heading() })
        if (action != null && onAction != null) {
            Box(
                Modifier
                    .heightIn(min = 48.dp)
                    .clip(PillShape)
                    .clickable(role = Role.Button, onClick = onAction)
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(action, style = TonyType.Label, color = TonyColors.Text2)
            }
        }
    }
}

/** Campo "Pergunte ao Tony…" (pill 56dp) com botão de enviar circular branco. */
@Composable
fun AskField(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    placeholder: String = "Pergunte ao Tony…",
) {
    val canSend = enabled && value.isNotBlank()
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(PillShape)
            .background(TonyColors.Surface)
            .border(1.dp, TonyColors.Border2, PillShape)
            .padding(start = 20.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text(placeholder, style = TonyType.Body, color = TonyColors.Text2)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                textStyle = TonyType.Body.copy(color = TonyColors.Text),
                cursorBrush = SolidColor(TonyColors.Text),
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { if (canSend) onSend() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = placeholder },
            )
        }
        Spacer(Modifier.width(8.dp))
        CircleIconButton(TonyIcons.ArrowUp, "Enviar", onClick = onSend, filled = true, enabled = canSend, size = 44.dp)
    }
}

@Composable
fun Chip(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Box(
        modifier
            .heightIn(min = 40.dp)
            .clip(PillShape)
            .border(1.dp, TonyColors.Border2, PillShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = TonyType.Caption, color = if (enabled) TonyColors.Text else TonyColors.Text2)
    }
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(PillShape)
            .background(if (enabled) TonyColors.Text else TonyColors.Elevated)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = TonyType.BodyMedium, color = if (enabled) TonyColors.OnPrimary else TonyColors.Text2)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(PillShape)
            .border(1.dp, TonyColors.Border2, PillShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = TonyColors.Text, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
        }
        Text(text, style = TonyType.BodyMedium, color = if (enabled) TonyColors.Text else TonyColors.Text2)
    }
}

/** Campo de texto pill no estilo do app. */
@Composable
fun TonyTextField(
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
        Text(label, style = TonyType.Caption, color = TonyColors.Text2, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .clip(PillShape)
                .background(TonyColors.Surface)
                .border(1.dp, TonyColors.Border2, PillShape)
                .padding(horizontal = 20.dp, vertical = 14.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, style = TonyType.Body, color = TonyColors.Text2)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = TonyType.Body.copy(color = TonyColors.Text),
                cursorBrush = SolidColor(TonyColors.Text),
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

@Composable
fun ToggleRow(title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(role = Role.Switch) { onChange(!checked) }
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = TonyType.Body, color = TonyColors.Text)
            if (subtitle != null) Text(subtitle, style = TonyType.Caption, color = TonyColors.Text2)
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedThumbColor = TonyColors.OnPrimary,
                checkedTrackColor = TonyColors.Text,
                checkedBorderColor = TonyColors.Text,
                uncheckedThumbColor = TonyColors.Text2,
                uncheckedTrackColor = TonyColors.Bg,
                uncheckedBorderColor = TonyColors.Border2,
            ),
        )
    }
}

/** Linha de ajuste clicável: título, valor e chevron. */
@Composable
fun ValueRow(title: String, value: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = TonyType.Body, color = TonyColors.Text, modifier = Modifier.weight(1f))
        Text(value, style = TonyType.Body, color = TonyColors.Text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.width(8.dp))
        Icon(TonyIcons.ChevronRight, contentDescription = null, tint = TonyColors.Text2, modifier = Modifier.size(18.dp))
    }
}

@Composable
fun MessageState(title: String, body: String?, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = TonyType.Section, color = TonyColors.Text)
        if (body != null) {
            Spacer(Modifier.height(6.dp))
            Text(body, style = TonyType.Caption, color = TonyColors.Text2)
        }
        if (action != null && onAction != null) {
            Spacer(Modifier.height(16.dp))
            Box(Modifier.width(180.dp)) { SecondaryButton(action, onAction) }
        }
    }
}

/** Banner interno com o visual das notificações do Tony (#141414, raio 24). */
@Composable
fun NotificationCard(title: String, body: String, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val shape = RoundedCornerShape(24.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(TonyColors.Elevated)
            .border(1.dp, TonyColors.Border, shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(16.dp)
            .semantics(mergeDescendants = true) {},
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TonyMark(20.dp)
            Spacer(Modifier.width(8.dp))
            Text("Tony · agora", style = TonyType.Small, color = TonyColors.Text2)
        }
        Spacer(Modifier.height(10.dp))
        Text(title, style = TonyType.Title, color = TonyColors.Text)
        Spacer(Modifier.height(2.dp))
        Text(body, style = TonyType.Label, color = TonyColors.Text3)
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
