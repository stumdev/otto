package app.otto.data

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

/** Mesma formatação do servidor, sem depender do Locale do aparelho. */
object Money {
    const val MINUS = '−'

    /** 4821590 -> "R$ 48.215,90" */
    fun brl(cents: Long): String {
        val a = abs(cents)
        val reais = (a / 100).toString().reversed().chunked(3).joinToString(".").reversed()
        val c = (a % 100).toString().padStart(2, '0')
        return "R$ $reais,$c"
    }

    /** Sinal sempre junto ao valor: "+ R$ 3.240,00" / "− R$ 1.115,40". */
    fun signed(cents: Long): String = when {
        cents > 0 -> "+ ${brl(cents)}"
        cents < 0 -> "$MINUS ${brl(cents)}"
        else -> brl(0)
    }

    /** "1.500,00" ou "1500" ou "1500,5" -> centavos; null se inválido. */
    fun parseReais(input: String): Long? {
        val s = input.trim().replace("R$", "").replace(" ", "")
        if (s.isEmpty()) return null
        val normalized = when {
            s.contains(',') -> s.replace(".", "").replace(',', '.')
            // "1.500" ou "12.000.000": pontos como separador de milhar
            Regex("""^\d{1,3}(\.\d{3})+$""").matches(s) -> s.replace(".", "")
            else -> s
        }
        val m = Regex("""^(\d{1,12})(?:\.(\d{1,2}))?$""").matchEntire(normalized) ?: return null
        val reais = m.groupValues[1].toLong()
        val cents = m.groupValues[2].padEnd(2, '0').ifEmpty { "00" }.toLong()
        return reais * 100 + cents
    }

    /** Valor sem "R$" para campos de edição: 150000 -> "1.500,00" */
    fun plain(cents: Long): String = brl(cents).removePrefix("R$ ")
}

object Dates {
    val zone: ZoneId = ZoneId.of("America/Sao_Paulo")
    private val ptBR = Locale.forLanguageTag("pt-BR")
    private val weekday = listOf("Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom")
    private val months = listOf("jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez")

    fun today(): LocalDate = LocalDate.now(zone)

    /** "Qui, 19 nov" */
    fun shortLabel(d: LocalDate): String = "${weekday[d.dayOfWeek.value - 1]}, ${d.dayOfMonth} ${months[d.monthValue - 1]}"

    /** Cabeçalho de grupo na lista: "Hoje", "Ontem" ou "Qui, 19 nov" (+ ano se diferente). */
    fun dayHeader(iso: String): String {
        val d = runCatching { LocalDate.parse(iso) }.getOrNull() ?: return iso
        val t = today()
        return when (d) {
            t -> "Hoje"
            t.minusDays(1) -> "Ontem"
            else -> shortLabel(d) + if (d.year != t.year) " ${d.year}" else ""
        }
    }

    /** "agora", "há 5 min", "há 2 h", "ontem", "em 19/11". */
    fun relative(isoInstant: String?): String {
        val instant = isoInstant?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return "—"
        val mins = Duration.between(instant, Instant.now()).toMinutes()
        return when {
            mins < 1 -> "agora"
            mins < 60 -> "há $mins min"
            mins < 24 * 60 -> "há ${mins / 60} h"
            mins < 48 * 60 -> "ontem"
            else -> "em " + DateTimeFormatter.ofPattern("dd/MM", ptBR).format(instant.atZone(zone))
        }
    }
}

/** "openai/gpt-oss-120b" -> "GPT-OSS 120B"; "gemini-3.8-flash" -> "Gemini 3.8 Flash". */
fun friendlyModelName(raw: String): String {
    val id = raw.substringAfterLast('/')
    return id.split('-', '_').filter { it.isNotBlank() }.joinToString(" ") { t ->
        when {
            t.equals("gpt", true) || t.equals("oss", true) -> t.uppercase()
            t.matches(Regex("""\d+[a-zA-Z]""")) -> t.uppercase()
            else -> t.replaceFirstChar { it.uppercase() }
        }
    }.replace("GPT OSS", "GPT-OSS")
}
