package app.tony.bank

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ATENÇÃO: os textos abaixo são formatos PLAUSÍVEIS escritos à mão, não capturas reais do
 * app do Nubank. Quando tiver exemplos reais (Ajustes > Alertas instantâneos > Não
 * reconhecidas > Copiar), acrescente-os aqui como casos de teste.
 */
class BankNotificationParserTest {

    private fun parsed(title: String?, text: String?): ParsedBankEvent {
        val r = BankNotificationParser.parse(title, text)
        assertTrue("esperava reconhecer: $title / $text, veio $r", r is ParseResult.Parsed)
        return (r as ParseResult.Parsed).event
    }

    private fun ignored(title: String?, text: String?): ParseResult.Ignored {
        val r = BankNotificationParser.parse(title, text)
        assertTrue("esperava ignorar: $title / $text, veio $r", r is ParseResult.Ignored)
        return r as ParseResult.Ignored
    }

    @Test fun pixRecebido() {
        val e = parsed("Transferência recebida", "Você recebeu uma transferência pelo Pix de R$ 1.800,00 de João Silva.")
        assertEquals(ParsedBankEvent(180000, "João Silva", "PIX"), e)
    }

    @Test fun pixRecebidoNomeEmCaixaAlta() {
        val e = parsed("Pix recebido", "Você recebeu R$ 25,90 de MARIA DA SILVA SOUZA")
        assertEquals(2590L, e.amountCents)
        assertEquals("Maria da Silva Souza", e.counterpart)
    }

    @Test fun pixEnviado() {
        val e = parsed("Pix enviado", "Você enviou R$ 215,40 para Mercado Central.")
        assertEquals(ParsedBankEvent(-21540, "Mercado Central", "PIX"), e)
    }

    @Test fun compraNoDebito() {
        val e = parsed("Compra no débito aprovada", "Compra no débito de R$ 32,50 aprovada")
        assertEquals(-3250L, e.amountCents)
        assertEquals("CARTAO", e.method)
    }

    @Test fun espacoNaoSeparavelEValorGrande() {
        val e = parsed(null, "Você recebeu um Pix de R$ 12.345.678,09 de Empresa Alfa LTDA")
        assertEquals(1_234_567_809L, e.amountCents)
        assertEquals("Empresa Alfa LTDA", e.counterpart)
    }

    @Test fun ignoraSaldoComoValor() {
        val e = parsed("Pix recebido", "Você recebeu R$ 100,00 de Ana. Seu saldo é R$ 5.000,00")
        assertEquals(10000L, e.amountCents)
    }

    @Test fun semNomeContinuaValido() {
        val e = parsed("Pix recebido", "Você recebeu R$ 10,00")
        assertEquals(null, e.counterpart)
    }

    @Test fun ignoraCartaoDeCredito() {
        ignored("Compra aprovada", "Compra de R$ 89,90 aprovada no cartão de crédito em PADARIA")
    }

    @Test fun ignoraPedidoDePix() {
        ignored("Pedido de Pix", "João Silva pediu R$ 50,00 para você")
    }

    @Test fun ignoraAgendamentoEFalha() {
        ignored("Pix agendado", "Seu Pix de R$ 300,00 para Ana foi agendado")
        ignored("Pix não realizado", "Seu Pix de R$ 300,00 para Ana falhou")
    }

    @Test fun ignoraFaturaECaixinha() {
        ignored("Fatura fechada", "Sua fatura de R$ 1.200,00 fechou")
        ignored("Caixinha", "Você guardou R$ 200,00 na caixinha Viagem")
    }

    @Test fun ignoraSemValorOuAmbiguo() {
        val noMoney = ignored("Novidade", "Conheça o novo recurso do app")
        assertEquals(false, noMoney.moneyRelated)
        ignored("Pix", "Você recebeu R$ 10,00 e enviou R$ 20,00")
        ignored("Movimentação", "R$ 50,00 na sua conta")
    }
}
