package app.tony.bank

import java.text.Normalizer

/** Movimentação extraída do texto de uma notificação do app do banco. */
data class ParsedBankEvent(
    /** > 0 entrada, < 0 saída. */
    val amountCents: Long,
    val counterpart: String?,
    /** PIX, TED, CARTAO, BOLETO ou null. */
    val method: String?,
)

sealed interface ParseResult {
    data class Parsed(val event: ParsedBankEvent) : ParseResult

    /** [moneyRelated] = o texto tinha valor em R$ (vale guardar no diagnóstico). */
    data class Ignored(val reason: String, val moneyRelated: Boolean) : ParseResult
}

/**
 * Lê notificações do app do Nubank e reconhece entradas e saídas da CONTA.
 *
 * IMPORTANTE: o formato exato das notificações do Nubank não é documentado e pode mudar.
 * Este parser é deliberadamente conservador: só aceita quando encontra exatamente um valor
 * e uma direção inequívoca (entrada OU saída). Na dúvida, ignora — a transação ainda
 * chega pelo Open Finance depois. Tudo que tem "R$" e foi ignorado vai para o diagnóstico
 * (Ajustes > Alertas instantâneos), para ajustar as regras com textos reais.
 */
object BankNotificationParser {

    /** Pacote do app do Nubank na Play Store. */
    const val NUBANK_PACKAGE = "com.nu.production"
    val PACKAGES = setOf(NUBANK_PACKAGE)

    private val amountRegex = Regex("""R\$\s*(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?!\d)""")

    /**
     * Palavras que tornam a notificação inelegível: cartão de crédito, agendamentos, pedidos
     * de Pix (alguém pedindo dinheiro), falhas, estornos, caixinhas/rendimentos etc.
     * Comparadas sem acento e em minúsculas.
     */
    private val rejectWords = listOf(
        "fatura", "credito", "limite", "agendad", "agendamento", "programad", "lembrete", "cobranca",
        "vence", "vencimento", "cashback", "estorno", "estornad", "devolv", "devolucao", "falhou", "falha",
        "nao foi", "nao conseguimos", "cancelad", "recusad", "negad", "pendente", "aguardando", "em analise",
        "pedido de", "pediu", "solicit", "caixinha", "rendeu", "rendimento", "investi", "emprestimo",
        "parcela", "boleto disponivel", "codigo", "senha", "seguranca", "acesso",
    )

    private val inWords = listOf(
        "voce recebeu", "recebeu um pix", "recebeu uma transferencia", "pix recebido", "transferencia recebida",
        "recebido", "recebida", "caiu na sua conta", "deposito recebido", "entrou na sua conta",
    )

    private val outWords = listOf(
        "voce enviou", "voce fez um pix", "pix enviado", "pix realizado", "transferencia enviada",
        "transferencia realizada", "enviado", "enviada", "voce pagou", "pagamento realizado",
        "pagamento efetuado", "pagamento aprovado", "compra no debito", "compra aprovada no debito",
        "debito aprovado", "saiu da sua conta",
    )

    /** Valor precedido por estas palavras não é o valor da movimentação (ex.: "saldo de R$ ..."). */
    private val nonAmountContext = listOf("saldo", "limite", "disponivel", "total da fatura")

    fun normalizeSpaces(s: String): String =
        s.replace(' ', ' ').replace(' ', ' ').replace(' ', ' ').replace(Regex("""\s+"""), " ").trim()

    fun stripAccents(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("""\p{M}+"""), "")

    fun parse(title: String?, text: String?): ParseResult {
        val full = normalizeSpaces(listOfNotNull(title, text).joinToString(" · "))
        if (full.isEmpty()) return ParseResult.Ignored("vazia", moneyRelated = false)
        val plain = stripAccents(full).lowercase()

        // valores, descartando os que vêm logo depois de "saldo", "limite"...
        val amounts = amountRegex.findAll(full).filter { m ->
            val before = stripAccents(full.substring(maxOf(0, m.range.first - 24), m.range.first)).lowercase()
            nonAmountContext.none { before.contains(it) }
        }.map { m -> m.groupValues[1].replace(".", "").toLong() * 100 + m.groupValues[2].toLong() }
            .distinct()
            .toList()
        val moneyRelated = full.contains("R$")
        if (amounts.isEmpty()) return ParseResult.Ignored("sem valor", moneyRelated)
        if (amounts.size > 1) return ParseResult.Ignored("mais de um valor", moneyRelated)
        val cents = amounts.single()
        if (cents <= 0) return ParseResult.Ignored("valor zero", moneyRelated)

        rejectWords.firstOrNull { plain.contains(it) }?.let { return ParseResult.Ignored("ignorada ($it)", moneyRelated) }

        val isIn = inWords.any { plain.contains(it) }
        val isOut = outWords.any { plain.contains(it) }
        if (isIn == isOut) return ParseResult.Ignored(if (isIn) "direção ambígua" else "direção desconhecida", moneyRelated)

        val method = when {
            Regex("""\bpix\b""").containsMatchIn(plain) -> "PIX"
            Regex("""\bted\b""").containsMatchIn(plain) -> "TED"
            plain.contains("debito") -> "CARTAO"
            plain.contains("boleto") -> "BOLETO"
            else -> null
        }
        val counterpart = extractCounterpart(full, incoming = isIn)
        return ParseResult.Parsed(ParsedBankEvent(if (isIn) cents else -cents, counterpart, method))
    }

    private val stopAfterName = Regex(
        """\s*(?:[.,!;:·|]|\s(?:no valor|na sua|no seu|na conta|em sua|em seu|via|pelo|pela|com|às|as|hoje|agora|em)\b|$)""",
        RegexOption.IGNORE_CASE,
    )

    /** "... de João Silva." (entrada) / "... para Mercado Central" (saída). */
    fun extractCounterpart(full: String, incoming: Boolean): String? {
        val lead = if (incoming) Regex("""\b(?:de|do|da)\s+""", RegexOption.IGNORE_CASE) else Regex("""\b(?:para|pra)\s+""", RegexOption.IGNORE_CASE)
        for (m in lead.findAll(full)) {
            val rest = full.substring(m.range.last + 1)
            if (rest.startsWith("R$") || rest.firstOrNull()?.isDigit() == true) continue
            val end = stopAfterName.find(rest)?.range?.first ?: rest.length
            val candidate = rest.substring(0, end).trim()
            if (candidate.length < 2 || candidate.length > 60) continue
            if (!candidate.first().isLetter()) continue
            if (candidate.contains("R$")) continue
            // termos genéricos não são nomes ("de transferência", "para você")
            val low = stripAccents(candidate).lowercase()
            if (low.split(' ').first() in setOf("voce", "sua", "seu", "uma", "um", "transferencia", "pix", "pagamento", "compra")) continue
            return titleCaseIfUpper(candidate)
        }
        return null
    }

    private fun titleCaseIfUpper(s: String): String {
        if (s != s.uppercase()) return s
        val small = setOf("da", "de", "do", "das", "dos", "e")
        return s.lowercase().split(' ').joinToString(" ") { w ->
            if (w in small) w else w.replaceFirstChar { it.titlecase() }
        }.replace(Regex("""\b(Ltda|Me|Sa|Eireli)\b""")) { it.value.uppercase() }
    }
}
