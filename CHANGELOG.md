# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [2.0.0] - 2026-11-19

### Adicionado
- **Contas de usuário**: cadastro e login com e-mail e senha (`scrypt`), sessões revogáveis, código de convite opcional (`SIGNUP_CODE`) e limite de cadastros por IP.
- **Servidor multiusuário**: um banco SQLite por pessoa, com os dados financeiros totalmente isolados.
- **Conexão do Nubank dentro do app** pelo widget Pluggy Connect, com verificação de que o item pertence ao usuário.
- Exclusão da conta e desconexão do banco, que revoga o consentimento na Pluggy e apaga os dados (LGPD).
- Tela de criar conta/entrar e tela de conectar o Nubank; o endereço do servidor vai embutido no app (`otto.serverUrl`).
- Modelo de IA em uso exibido no chat; Ajustes reformulados com ícones e descrições; animações em todo o app.

### Alterado
- O app não pede mais endereço do servidor nem token: criar conta → conectar o Nubank → usar.
- `DATABASE_PATH` virou `DATA_DIR`; `APP_TOKEN` e `PLUGGY_ITEM_IDS` deixaram de existir.
- O chat gasta menos tokens (resposta máxima menor e raciocínio reduzido) para respeitar o limite gratuito da Groq.

### Removido
- Leitura de QR code de configuração e o script `setup-qr`.
- Indicadores de horário de sincronização na interface.

## [1.0.0] - 2026-11-17

### Adicionado
- App Android (Kotlin + Jetpack Compose) com Início, Conversa com IA, Movimentações e Ajustes.
- Servidor (Fastify + SQLite) com modo mock, Open Finance via Pluggy, webhooks, push (FCM) e chat com IA (Groq, com Gemini de reserva) usando tool calling.
- Alertas instantâneos pela leitura das notificações do app do Nubank.
- Caixinhas e cartão de crédito (fatura, limite e próximas faturas).
- Resumo diário, alerta de saída grande, bloqueio por biometria e proteção de tela.
