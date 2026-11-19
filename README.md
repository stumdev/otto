# Otto

**Seu dinheiro, em tempo real.** Assistente financeiro para Android: mostra saldo, quanto entrou e saiu hoje, avisa por notificação a cada movimentação, manda um resumo diário e responde perguntas num chat com IA, com dados do Nubank via Open Finance.

**Para quem usa:** instala o app → cria uma conta (e-mail e senha) → conecta o Nubank → pronto. Nada de servidor, endereço ou token. O endereço do servidor vai embutido no app (seção 2.3); quem opera o serviço sobe o servidor uma vez.

- `server/` — Node.js 24 + TypeScript + Fastify + SQLite (better-sqlite3) + Zod
- `app/` — Android nativo: Kotlin + Jetpack Compose (tema próprio preto e branco), Hilt, Retrofit/OkHttp, kotlinx.serialization
- `docker-compose.yml` — sobe o servidor (e, opcionalmente, um Cloudflare Tunnel)
- `.env.example` — todas as variáveis, documentadas

---

## Sumário

1. [Arquitetura](#1-arquitetura)
2. [Rodar em modo mock (sem nenhuma chave)](#2-rodar-em-modo-mock-sem-nenhuma-chave)
3. [Ligar o modo real](#3-ligar-o-modo-real)
4. [Privacidade: o que a IA recebe](#4-privacidade-o-que-a-ia-recebe)
5. [Segurança](#5-segurança)
6. [Expor o servidor com HTTPS](#6-expor-o-servidor-com-https)
7. [APK de release assinado](#7-apk-de-release-assinado)
8. [Backup do SQLite](#8-backup-do-sqlite)
9. [Testes](#9-testes)
10. [Diferenças em relação ao briefing (o que a documentação mandou mudar)](#10-diferenças-em-relação-ao-briefing)
11. [Solução de problemas](#11-solução-de-problemas)
12. [Referência da API](#12-referência-da-api)

---

## 1. Arquitetura

```
 ┌────────────┐  HTTPS + Bearer   ┌──────────────────────────────┐   X-API-KEY   ┌─────────┐   Open Finance   ┌────────┐
 │  App Otto  │ ────────────────▶ │  Servidor Otto (Fastify)     │ ────────────▶ │ Pluggy  │ ───────────────▶ │ Nubank │
 │  (Android) │ ◀──── SSE (chat)  │  SQLite · jobs · outbox      │ ◀── webhooks  │         │                  │        │
 └─────▲──────┘                   │                              │               └─────────┘                  └────────┘
       │ push (dados)             │  tool calling (só agregados) │
 ┌─────┴──────┐ ◀──────────────── │                              │ ───────────▶  Groq (principal) → Gemini (fallback)
 │  Firebase  │   Admin SDK (FID) └──────────────────────────────┘
 └────────────┘
```

- **O app fala só com o seu servidor.** Nunca com o banco, o agregador ou a IA.
- **Dados bancários via Pluggy (Open Finance).** Nada de senha do banco, scraping ou biblioteca não oficial. O servidor guarda só o `itemId` e as credenciais da API da Pluggy (no `.env`).
- **Sincronização:** webhooks da Pluggy (`transactions/created|updated|deleted`, `item/*`) + polling de segurança a cada `SYNC_INTERVAL_MINUTES` (padrão 5). O polling é só leitura: nunca dispara atualização no banco.
- **Notificações:** toda notificação vai para uma *outbox* no SQLite com chave idempotente (`tx:<externalId>`, `summary:<data>`). A mesma transação nunca notifica duas vezes. Se o FCM estiver configurado, o servidor envia push; senão, o app busca a outbox e mostra **notificação local**.
- **Valores sempre em centavos (inteiros).** "Hoje", "semana" (a partir de segunda) e "mês" no fuso `America/Sao_Paulo`, independente do fuso do servidor.
- **Chat:** streaming por SSE. A IA usa *tool calling* — `get_balance`, `get_period_summary(from,to)`, `get_top_transactions(period,direction,limit)`, `search_transactions(query,period)` — que rodam localmente no SQLite e devolvem só agregados ou no máximo 10 itens. Retry com backoff exponencial e troca de provedor em 429/5xx/erros de rede. Sem chave, um motor de regras responde (saldo, entrou/saiu, maiores saídas, gastos por nome).

> ⚠️ **O Open Finance sozinho não é tempo real.** Pela documentação da Pluggy, itens de Open Finance são atualizados automaticamente **uma vez por dia**, e no **Meu Pluggy** (o caminho gratuito para uso pessoal) os dados são renovados **a cada 24 h** e não podem ser atualizados manualmente. Por isso o Otto tem os **alertas instantâneos** (abaixo), que leem a notificação do próprio app do Nubank no celular.

### Alertas instantâneos (leitura da notificação do Nubank)

```
 Pix cai ─▶ app do Nubank mostra a notificação ─▶ Otto (no mesmo celular) lê o texto
          ─▶ extrai valor, entrada/saída, nome e tipo ─▶ POST /v1/events/bank-notification
          ─▶ servidor grava como PROVISÓRIA (já entra no saldo) e devolve o aviso com saldo
          ─▶ horas depois a Pluggy entrega a oficial ─▶ casada com a provisória, sem novo aviso
```

- **Em segundos**, sem senha, sem scraping, sem custo. Só funciona com o app do Nubank instalado **e com as notificações dele ativas** no mesmo celular do Otto.
- O Otto só lê notificações do pacote `com.nu.production`; todas as outras são descartadas sem leitura do conteúdo. **O texto bruto não sai do aparelho**: ao servidor vão só valor, nome da contraparte, tipo (Pix/TED/débito) e horário, mais uma impressão digital SHA-256 para deduplicar.
- **Casamento com o Open Finance:** a transação oficial com o **mesmo valor e sinal**, em até **±1 dia**, substitui a provisória (a mais próxima no horário) e **não notifica de novo**. Se a Pluggy entregar antes da notificação, o servidor só vincula. Provisórias nunca confirmadas saem do saldo depois de `PROVISIONAL_TTL_HOURS` (padrão 96 h). Na lista elas aparecem como "· a confirmar".
- **Servidor fora do ar:** o app mostra o aviso local na hora (sem saldo) e reenvia em segundo plano marcando que já avisou, para não haver aviso duplicado.
- **O leitor é conservador.** Ele só aceita quando encontra **um** valor em R$ e uma direção inequívoca. Ignora cartão de **crédito**, fatura, Pix agendado, **pedido de Pix**, falha, estorno, caixinhas e similares, que continuam chegando pelo Open Finance.

**Como ativar:** *Ajustes → Alertas instantâneos → Ativar acesso a notificações* e ligue o Otto. No **Android 13+, com o APK instalado fora da Play Store**, a opção aparece bloqueada ("configuração restrita"). Nesse caso, abra *Informações do app* (botão logo abaixo), toque em **⋮ → Permitir configurações restritas**, volte e ative. Alguns fabricantes encerram serviços em segundo plano: tire o Otto da otimização de bateria.

> **Limitação honesta:** o formato das notificações do Nubank não é documentado e pode mudar a qualquer atualização do app dele. As regras foram escritas a partir de formatos plausíveis, **não de capturas reais**. Por isso existe *Ajustes → Alertas instantâneos → Notificações não reconhecidas*, que guarda (cifradas, só no aparelho) as últimas 20 notificações do Nubank com valor em R$ que o leitor ignorou. Se algum Pix ou débito na conta estiver lá, use **Copiar** e acrescente o texto aos testes em `app/app/src/test/java/app/otto/bank/BankNotificationParserTest.kt` para ajustar `BankNotificationParser.kt`. No build debug, *Simular notificação do Nubank* testa o caminho completo sem fazer um Pix.

---

## 2. Rodar em modo mock (sem nenhuma chave)

Com `MOCK_MODE=true`, o servidor gera ~60 dias de transações fictícias e plausíveis (Pix recebidos/enviados, mercado, assinaturas, contas, aluguel…). O saldo é **sempre** a soma das transações. A cada sincronização, as transações "do dia" que já "aconteceram" vão surgindo e geram notificação, como num banco de verdade.

### 2.1 Servidor com Docker

```bash
cp .env.example .env                      # MOCK_MODE=true já vem ligado
docker compose up -d --build
curl http://127.0.0.1:8080/health        # {"status":"ok","version":"2.0.0","mode":"mock"}
```

Por padrão a porta só escuta em `127.0.0.1`. Para testar com o celular na mesma rede Wi-Fi: `OTTO_BIND=0.0.0.0 docker compose up -d`.

### 2.2 Servidor sem Docker (Node 24 LTS)

```bash
cd server
npm ci
# no .env, para rodar fora do Docker: DATA_DIR=./data
npm run build && npm start                # ou: npm run dev
```

Os dados ficam em `DATA_DIR`: `directory.db` (contas e sessões) e `users/<id>.db` — **um arquivo SQLite por usuário**, o que isola totalmente os dados financeiros de cada pessoa.

### 2.3 App

Requisitos: Android Studio (ou só o Android SDK) e JDK 17+.

O **endereço do servidor é embutido no app** em tempo de build, pela propriedade `otto.serverUrl`:

| Build | Endereço |
|---|---|
| `debug` | `http://10.0.2.2:8080` (emulador → servidor na sua máquina), ou o que você definir |
| `release` | **obrigatório**: `https://...` — o build falha com uma mensagem clara se faltar |

Defina em `app/local.properties` (fora do git) ou com `-Potto.serverUrl=...`:

```properties
otto.serverUrl=https://otto.seudominio.com
```

```bash
cd app
./gradlew assembleDebug                   # app/app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug                    # com um aparelho/emulador conectado
```

**Primeiro uso (o que a pessoa vê):** tela *Crie sua conta* (nome opcional, e-mail, senha de 8+ caracteres) → tela *Conecte seu Nubank* → o widget **Pluggy Connect** abre dentro do app, a pessoa escolhe o Nubank e autoriza no app do próprio banco (Open Finance) → o Otto importa os últimos 90 dias e abre a tela Início. Em *Ajustes* ficam **Sair da conta**, **Desconectar o Nubank** (revoga o consentimento na Pluggy e apaga os dados importados) e **Excluir minha conta**.

Com o servidor em `MOCK_MODE=true`, o passo do banco vira um botão **Usar conta de demonstração**, com movimentações fictícias — bom para testar sem chaves.

> **Android 17+:** apps com `targetSdk 37` precisam da permissão `ACCESS_LOCAL_NETWORK` para falar com endereços da rede local ([documentação](https://developer.android.com/privacy-and-security/local-network-permission)). O app só pede quando o servidor embutido é local (emulador, desenvolvimento); um servidor público com HTTPS não precisa dela.

> `http://` só funciona no **build debug**. O release aceita apenas `https://` (`usesCleartextTraffic=false` e `network_security_config` restrito).

### 2.4 "Simular Pix"

No build **debug**, faça **pressão longa na marca do Otto** (canto superior esquerdo da tela Início). O servidor cria um Pix fictício, atualiza o saldo e dispara a notificação — `Entrou R$ 1.800,00 · Pix de João Silva · Saldo R$ 48.215,90`. Com o app aberto ela aparece como um cartão no topo; com o app em segundo plano, como notificação do sistema.

Pelo terminal (use o token devolvido por `POST /v1/auth/login`):

```bash
curl -X POST http://127.0.0.1:8080/v1/dev/simulate \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"direction":"out","amountCents":21540}'
```

`/v1/dev/simulate` só existe com `MOCK_MODE=true`.

### 2.5 Notificação sem FCM (fallback local)

Sem Firebase configurado, **tudo continua funcionando**: o app consulta `GET /v1/notifications?after=<último id>` e mostra notificações locais nos canais certos.

- Com o app aberto: a cada ~20 s.
- Com o app fechado: via WorkManager a cada **15 min** (o mínimo que o Android permite; em economia de bateria pode atrasar mais).

Para receber em segundos com o app fechado, configure o FCM (seção 3.3).

---

## 3. Ligar o modo real

### 3.1 Pluggy + Nubank (Open Finance)

Cada usuário conecta o **próprio** Nubank dentro do app, pelo widget **Pluggy Connect**. O servidor só precisa das credenciais da *sua aplicação* na Pluggy:

1. Crie uma conta no **[Dashboard da Pluggy](https://dashboard.pluggy.ai)**, crie uma *Application* e anote o **Client ID**; gere o **Client Secret** (aparece uma vez só).
2. No `.env`:
   ```ini
   MOCK_MODE=false
   PLUGGY_CLIENT_ID=...
   PLUGGY_CLIENT_SECRET=...
   ```
3. Como funciona por baixo: o app pede `POST /v1/connection/token`; o servidor cria um *connect token* na Pluggy com `clientUserId = id do usuário`; o app abre `https://<seu-servidor>/connect#token=...` numa WebView (a página carrega o widget; o token vai no *fragmento* da URL, que não chega aos logs); ao terminar, a WebView volta ao app por `otto://connected?itemId=...`; o app chama `POST /v1/connection/items` e o servidor **confere na Pluggy que o item pertence àquele usuário** (`clientUserId`) antes de aceitar. O script do widget vem de `PLUGGY_CONNECT_SCRIPT_URL` (padrão: `cdn.pluggy.ai/pluggy-connect/v2.7.0`; atualize se a Pluggy publicar versão nova).
4. Confira um item: `cd server && npm run pluggy:check -- <itemId>`.

> **Plano da Pluggy:** conectar o Nubank de **qualquer pessoa** (não só o seu) depende do plano da sua aplicação na Pluggy; o caminho gratuito "Meu Pluggy" é só para uso pessoal e sem fins comerciais. Veja os planos e o que o ambiente de testes permite antes de abrir o app ao público.

O consentimento do Open Finance vale **1 ano** (`consentExpiresAt`). Ao expirar, o item vai para `LOGIN_ERROR`/`USER_AUTHORIZATION_EXPIRED`; o servidor recebe o webhook `item/error` e avisa o usuário por notificação. Hoje a renovação é desconectar e conectar de novo nos Ajustes.

Na primeira sincronização de cada usuário, o Otto importa os últimos 90 dias **sem notificar**. Depois, só notifica transações novas (no máximo `NOTIFY_MAX_AGE_HOURS` de idade).

### 3.2 Webhook da Pluggy

Webhooks exigem uma URL **HTTPS pública na porta 443** (veja a seção 6). O webhook é da *aplicação* (vale para todos os usuários); o servidor descobre de quem é cada evento pelo `itemId`. Depois:

```ini
PUBLIC_BASE_URL=https://otto.seudominio.com
PLUGGY_WEBHOOK_HEADER_SECRET=<npm run gen-token>
```

```bash
cd server && npm run pluggy:register-webhook       # cria o webhook "all" -> /v1/webhooks/pluggy
npm run pluggy:register-webhook -- --list          # lista os existentes
```

Recomendado também: no Dashboard, *Aplicação → Webhooks → Generate signing secret* e coloque o `whsec_...` em `PLUGGY_WEBHOOK_SIGNING_SECRET`. O servidor então exige **as duas camadas**: o cabeçalho secreto e a assinatura HMAC `X-Pluggy-Signature` (verificada sobre o corpo bruto, com tolerância de 5 min contra replay e comparação em tempo constante). Sem nenhum segredo configurado, todo webhook é recusado e só o polling sincroniza.

Rotação do signing secret: coloque o novo em `PLUGGY_WEBHOOK_SIGNING_SECRET`, o antigo em `..._PREVIOUS` e `PLUGGY_WEBHOOK_ROTATING=true` (falhas viram `503`, que a Pluggy reenvia, em vez de `401`, que ela descarta). Depois de algumas horas, remova o antigo e volte `ROTATING=false`.

Opcional: libere no firewall só o IP de origem dos webhooks da Pluggy, `52.67.145.81` (confira o valor atual na documentação).

### 3.3 Firebase Cloud Messaging (push)

1. Crie um projeto em **[console.firebase.google.com](https://console.firebase.google.com)**.
2. Adicione um app **Android** com o pacote **`app.otto`**. Baixe o `google-services.json` e coloque em **`app/app/google-services.json`** (está no `.gitignore`). O build detecta o arquivo e liga o plugin do Google Services automaticamente.
3. Em *Configurações do projeto → Contas de serviço → Gerar nova chave privada*, baixe o JSON e salve como `secrets/firebase-service-account.json` (raiz do repo; também ignorado pelo git).
4. No `.env`:
   - Docker: `FIREBASE_SERVICE_ACCOUNT_FILE=/run/secrets/otto/firebase-service-account.json`
   - Sem Docker: `FIREBASE_SERVICE_ACCOUNT_FILE=../secrets/firebase-service-account.json`
5. Recompile o app (`./gradlew assembleDebug`), reinicie o servidor e use **Ajustes → Testar notificação**. A linha "Entrega" nos Ajustes mostra se o push está ativo.

O servidor manda mensagens **só de dados** (prioridade alta); o app monta a notificação com o canal certo (`entradas`, `saidas`, `resumo`), o ícone monocromático do Otto e o toque abrindo a tela certa.

### 3.4 IA: Groq (principal) e Gemini (fallback)

- **Groq**: crie uma chave em [console.groq.com/keys](https://console.groq.com/keys) → `GROQ_API_KEY`. Modelo padrão `openai/gpt-oss-120b` (em produção na Groq em nov/2026; não suporta chamadas de ferramenta em paralelo, o que o Otto não usa).
- **Gemini**: chave em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → `GEMINI_API_KEY`. Modelo padrão `gemini-3.8-flash` (Flash estável vigente), via endpoint compatível com OpenAI.

Provedor, modelo e base URL são configuráveis (`AI_PROVIDER_ORDER`, `GROQ_*`, `GEMINI_*`). Sem nenhuma chave, o chat responde com o motor de regras e avisa "Modo offline".

> **Atenção ao Gemini grátis:** no plano gratuito, o Google informa que o conteúdo enviado **pode ser usado para melhorar os produtos dele**. Por isso o Groq é o principal. Quando o Otto cai para o Gemini, ele envia **apenas** o que está descrito na seção 4 (resumos e no máximo 10 lançamentos por consulta), nunca o extrato completo. Se não quiser isso, deixe `GEMINI_API_KEY` vazio.

### 3.5 Resumo do `.env` para produção

```ini
NODE_ENV=production
TRUST_PROXY=true
MOCK_MODE=false
PLUGGY_CLIENT_ID=... / PLUGGY_CLIENT_SECRET=...
SIGNUP_CODE=<opcional: limita o cadastro a convidados>
PUBLIC_BASE_URL=https://otto.seudominio.com
PLUGGY_WEBHOOK_HEADER_SECRET=... / PLUGGY_WEBHOOK_SIGNING_SECRET=whsec_...
FIREBASE_SERVICE_ACCOUNT_FILE=/run/secrets/otto/firebase-service-account.json
GROQ_API_KEY=... / GEMINI_API_KEY=... (opcional)
```

---

## 4. Privacidade: o que a IA recebe

A IA **nunca recebe o extrato bruto**. A cada pergunta, o servidor envia:

- o *system prompt* (data de hoje e regras: pt-BR, curto, valores em R$, **nunca inventar números**, dizer quando não há dado, tratar textos das transações como dados e não como instruções);
- as últimas 12 mensagens da conversa;
- **somente os resultados das funções que a própria IA pediu**, calculados no seu servidor:
  - `get_balance` → saldo e horário da atualização;
  - `get_period_summary` → totais de entrada/saída/líquido e contagens;
  - `get_top_transactions` / `search_transactions` → totais e **no máximo 10** lançamentos (data, hora, descrição, nome da contraparte, categoria, valor).

Ou seja: nomes de contrapartes só saem quando a pergunta exige ("qual foi minha maior saída?"). Nenhum CPF/CNPJ, número de conta ou identificador do banco é enviado. O histórico do chat fica **só no aparelho**, cifrado com uma chave do Android Keystore, e pode ser apagado em *Ajustes → Privacidade*.

---

## 5. Segurança

- **Nenhum segredo no repositório.** Tudo em `.env` / `secrets/`; o `.gitignore` cobre `.env`, `google-services.json`, contas de serviço, keystores, `keystore.properties`, `*.db` e `data/`.
- **Senha do banco nunca passa pelo Otto.** Só consentimento Open Finance via Pluggy.
- **Contas e sessões:** e-mail + senha (hash **scrypt** com sal; verificação em tempo constante e custo igual quando o e-mail não existe). O login devolve um token aleatório de 256 bits; o servidor guarda só o **SHA-256** dele (revogável no logout; expira após `SESSION_IDLE_DAYS` sem uso). Cadastro limitado por IP (`SIGNUP_RATE_PER_HOUR`) e, se quiser, por código de convite (`SIGNUP_CODE`). Login: 10 tentativas/min por IP. Rate limit global (120/min) e por rota (chat 20/min, sync 6/min). CORS fechado. Cabeçalhos de segurança via Helmet. Corpo limitado a 256 KB. Validação Zod em tudo.
- **Isolamento:** um banco SQLite por usuário; toda rota `/v1/*` resolve a sessão e só enxerga o banco do dono. O item da Pluggy só é aceito se criado com o connect token do mesmo usuário.
- **LGPD:** `DELETE /v1/account` (pede a senha) apaga a conta, sessões e todos os dados, e revoga os itens na Pluggy; `DELETE /v1/connection` faz o mesmo só com os dados bancários.
- **Logs:** cabeçalhos `Authorization` e `X-Pluggy-Signature` são redigidos; valores de transações e corpos de erro dos provedores de IA não são registrados.
- **Contêiner:** usuário não-root, sistema de arquivos somente leitura (exceto o volume `/data`), `no-new-privileges`, todas as *capabilities* removidas, porta presa em `127.0.0.1`.
- **App:** token da sessão cifrado com AES-256-GCM no **Android Keystore** (a lib `EncryptedSharedPreferences` foi descontinuada pelo Google; usamos o Keystore direto). **Bloqueio por biometria/PIN ligado por padrão** (ao abrir e após 1 min em segundo plano). **`FLAG_SECURE`** ligado por padrão (sem capturas de tela, prévia oculta em Recentes; dá para desligar nos Ajustes). Backup em nuvem e transferência entre aparelhos desativados. Notificações na tela de bloqueio mostram só "Nova movimentação na conta". Release: só HTTPS e só certificados do sistema.
- **Dependências fixadas** em versões exatas (`--save-exact`, catálogo Gradle), escolhidas com pelo menos ~2 semanas de publicação quando possível; scripts de instalação npm liberados só para `better-sqlite3` e `esbuild` (`allowScripts`). `npm audit`: **0 vulnerabilidades** na data da entrega. O Gradle wrapper valida o SHA-256 da distribuição.

---

## 6. Expor o servidor com HTTPS

Nunca abra a porta 8080 para a internet. Duas opções:

### Opção A — Cloudflare Tunnel (sem abrir portas no roteador)

1. No painel da Cloudflare: *Zero Trust → Networks → Tunnels → Create tunnel* (tipo *cloudflared*). Copie o token.
2. Em *Public Hostname*, aponte `otto.seudominio.com` para `http://otto:8080`.
3. Suba:
   ```bash
   CLOUDFLARE_TUNNEL_TOKEN=<token> docker compose --profile tunnel up -d
   ```

### Opção B — Caddy (certificado Let's Encrypt automático)

Num VPS com as portas 80/443 abertas e o DNS apontando para ele:

```caddyfile
# /etc/caddy/Caddyfile
otto.seudominio.com {
    reverse_proxy 127.0.0.1:8080
}
```

Em ambos os casos use `TRUST_PROXY=true` e `PUBLIC_BASE_URL=https://otto.seudominio.com`.

---

## 7. APK de release assinado

1. Gere uma chave (uma vez só; guarde fora do repositório e faça backup):
   ```bash
   keytool -genkeypair -v -keystore ~/otto-release.jks -alias otto -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Crie `app/keystore.properties` (ignorado pelo git):
   ```properties
   storeFile=C:/caminho/para/otto-release.jks
   storePassword=...
   keyAlias=otto
   keyPassword=...
   ```
3. Gere: `cd app && ./gradlew assembleRelease` → `app/app/build/outputs/apk/release/app-release.apk` (R8/minificação ligados).
4. Instale: `adb install app/app/build/outputs/apk/release/app-release.apk`.

Sem `keystore.properties`, o build gera `app-release-unsigned.apk`.

---

## 8. Backup do SQLite

O backup usa a API online do SQLite (consistente mesmo com o servidor rodando): copia `directory.db` e todos os `users/*.db` para `<destino>/<data-hora>/` e mantém os 14 mais recentes:

```bash
# Docker
docker compose exec otto node dist/cli/backup.js /data/backups
# sem Docker
cd server && npm run backup -- ./backups
```

Agende com cron (ex.: todo dia às 3h):

```cron
0 3 * * * cd /caminho/otto && docker compose exec -T otto node dist/cli/backup.js /data/backups
```

Os backups contêm o histórico financeiro de **todos** os usuários: guarde-os cifrados (ex.: `restic`, `age`) se saírem da máquina. Para restaurar: pare o servidor, substitua `data/directory.db` e `data/users/` pelo backup e suba de novo.

---

## 9. Testes

```bash
cd server
npm test          # Vitest: 89 testes
npm run typecheck
```

Cobrem: formatação de moeda e conversão decimal→centavos; agregação por período e fuso (incl. virada de dia em UTC); série de 7 dias e saldo de fechamento; deduplicação de notificações e de webhooks (`eventId`); texto das notificações; coerência do saldo mock (= soma, nunca negativo, sem duplicar); fallback de provedor de IA com HTTP simulado (retry/backoff em 429, troca para Gemini, 401 não insiste, queda para regras, tool calling com preservação da assinatura do Gemini); limite de itens das ferramentas; motor de regras; assinatura HMAC do webhook; API ponta a ponta (auth, CORS, paginação por cursor, validação, simulate→push, chat SSE); resumo diário no horário de São Paulo.

App: `cd app && ./gradlew testDebugUnitTest lint assembleDebug assembleRelease` (12 testes do leitor de notificações).

Alertas instantâneos (servidor): provisória entra no saldo e avisa; reenvio não duplica; a oficial da Pluggy substitui a provisória sem novo aviso; Pluggy antes da notificação só vincula; valores diferentes não se confundem; saída grande; `alreadyNotified`; recusa de horário futuro/evento antigo/servidor sem conta; expiração; rota com auth e validação.

---

## 10. Diferenças em relação ao briefing

Itens em que a documentação oficial (consultada em 19/11/2026) mandou fazer diferente:

| Briefing | Implementado | Motivo |
|---|---|---|
| Node.js 20 | **Node.js 24 LTS** | Node 20 saiu de suporte em abr/2026, e `better-sqlite3@13`/`firebase-admin@14` exigem Node ≥ 22. |
| `GET /transactions` da Pluggy | **`GET /v2/transactions`** (cursor) | O v1 está descontinuado e só funciona até 31/12/2026. Novidades buscadas com `createdAtFrom` (transações novas podem ter data no passado). |
| Tokens de registro do FCM | **Firebase Installation ID (FID)** | O FCM está migrando para FIDs (`onRegistered()` + `firebase_messaging_installation_id_enabled`); o Admin SDK 14 marca `tokens` como depreciado. O endpoint continua `POST /v1/devices`, com corpo `{"fid": "..."}`. |
| `EncryptedSharedPreferences` | **Android Keystore direto** (AES-GCM) | A biblioteca `security-crypto` foi descontinuada. |
| Modelo "Flash vigente" do Gemini | **`gemini-3.8-flash`** | Flash estável atual; `gemini-2.5-flash` foi depreciado. |
| Groq `openai/gpt-oss-120b` | mantido | Confirmado em produção. |
| Push "a cada Pix" | **alertas instantâneos** pela leitura da notificação do Nubank + Open Finance para confirmar | Meu Pluggy atualiza a cada 24 h (seção 1). |
| `targetSdk` atual | **37 (Android 17)**, AGP 9.5.1, Gradle 9.8.1, Kotlin 2.4.21 | Versões estáveis atuais. |
| Visual de notificação `#141414`, raio 24 | **banner dentro do app** com esse visual; na bandeja, notificação padrão do sistema | O Android não permite estilizar livremente notificações do sistema (cor de fundo/raio são do sistema). |
| Alerta de saída grande | mesma notificação, com corpo `Saída grande · Pix para … · Saldo …` | Para cumprir "a mesma transação nunca gera duas notificações". |

Endpoints extras além dos pedidos: `GET /v1/status`, `GET /v1/settings`, `GET /v1/notifications` (outbox para o fallback local), `POST /v1/sync` (pull-to-refresh) e `POST /v1/devices/test` (botão "Testar notificação").

---

## 11. Solução de problemas

| Sintoma | O que verificar |
|---|---|
| "MOCK_MODE=false exige PLUGGY_…" | Preencha `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` ou volte para `MOCK_MODE=true`. |
| App: "Sessão expirada. Entre de novo." | A sessão foi encerrada (logout em outro lugar, conta excluída ou sem uso por `SESSION_IDLE_DAYS`). Entre de novo. |
| Build release falha com "Defina otto.serverUrl" | Coloque `otto.serverUrl=https://...` em `app/local.properties` (seção 2.3). |
| Esqueci a senha | Ainda não há recuperação por e-mail (precisaria de um provedor de e-mail). Hoje só quem opera o servidor resolve, removendo a conta em `directory.db`. |
| App: "Sem conexão com o servidor" no emulador | O build **debug** aponta para `http://10.0.2.2:8080` (não `localhost`); o servidor precisa estar rodando. No Android 17+ aceite a permissão de **rede local** que o app pede. |
| Emulador não inicia ("hypervisor driver is not installed") | Instale o driver: `sdkmanager "extras/google/Android_Emulator_Hypervisor_Driver"` e rode `silent_install.bat` (pasta `SdkextrasgoogleAndroid_Emulator_Hypervisor_Driver`) como administrador. |
| App no celular não conecta | Em debug com servidor no PC: `otto.serverUrl=http://<IP-do-PC>:8080`, suba com `OTTO_BIND=0.0.0.0`, mesma rede Wi-Fi, firewall liberando a 8080; em release, só `https://`. |
| Widget do banco não abre / fica em branco | O celular precisa alcançar `https://<servidor>/connect` e `cdn.pluggy.ai`. Veja o log do servidor em `/v1/connection/token` (credenciais da Pluggy). |
| Não chegam notificações | Permissão de notificação concedida? Em *Ajustes*, veja a linha "Entrega". Sem FCM, com o app fechado, o intervalo mínimo é ~15 min. Economia de bateria agressiva (alguns fabricantes) atrasa o WorkManager: libere o Otto da otimização de bateria. |
| Build mostra "AVISO: google-services.json não tem o app Android 'app.otto'" | O arquivo foi gerado para outro pacote (por exemplo, de antes da mudança de nome). No Firebase, adicione um app Android com o pacote `app.otto`, baixe o `google-services.json` de novo e recompile. Até lá o app funciona com notificação local. |
| Push FCM não chega | `google-services.json` em `app/app/` e app recompilado; `FIREBASE_SERVICE_ACCOUNT_FILE` apontando para o JSON (log do servidor deve dizer "FCM habilitado"); mesmo projeto Firebase nos dois. |
| Transações reais não aparecem | `npm run pluggy:check -- <itemId>`. Com Meu Pluggy, os dados renovam a cada 24 h. Item em `LOGIN_ERROR`? Renove a autorização (seção 3.1). |
| Webhooks recusados (401) | Segredos no `.env` iguais aos do Dashboard/`register-webhook`; relógio do servidor sincronizado (NTP) — a assinatura tem tolerância de 5 min. |
| Alertas instantâneos não chegam | *Ajustes → Alertas instantâneos* diz "Ativo"? Notificações do Nubank ligadas no celular? Veja *Notificações não reconhecidas*: se o Pix está lá, o formato mudou (seção 1). Android 13+ fora da loja: "Permitir configurações restritas". Tire o Otto da otimização de bateria. |
| Pix aparece duas vezes na lista | Só acontece se o valor oficial for diferente do lido na notificação (o casamento exige o mesmo valor). A provisória expira sozinha em `PROVISIONAL_TTL_HOURS`. |
| Chat diz "Modo offline" | Nenhuma chave de IA configurada, ou todos os provedores falharam (veja o log `falha no provedor de IA`). |
| Docker: erro ao compilar `better-sqlite3` | A imagem de build já instala `python3 make g++`; confira se há rede no build. |
| Não consigo tirar print do app | É o `FLAG_SECURE`. Desligue em *Ajustes → Segurança → Proteger a tela*. |

---

## 12. Referência da API

Rotas públicas: `/health`, `/v1/config`, `/connect`, `/v1/auth/register`, `/v1/auth/login` e o webhook. Todas as outras `/v1/*` exigem `Authorization: Bearer <token da sessão>`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Público. `{status, version, mode}` |
| GET | `/v1/config` | Público. `{mode, signupCodeRequired, version}` |
| POST | `/v1/auth/register` | `{email, password(8+), name?, signupCode?}` → `{token, user}` |
| POST | `/v1/auth/login` | `{email, password}` → `{token, user}` |
| POST | `/v1/auth/logout` | Encerra a sessão |
| GET | `/v1/me` | Dados da conta |
| DELETE | `/v1/account` | `{password}` — exclui conta e dados (403 se a senha estiver errada) |
| GET | `/connect` | Página do widget Pluggy Connect (token no fragmento `#token=`) |
| GET | `/v1/connection` | `{connected, mode, items[]}` |
| POST | `/v1/connection/token` | Connect token da Pluggy (`{mock:true}` no modo demonstração) |
| POST | `/v1/connection/items` | `{itemId}` — valida o dono do item e faz a 1ª importação |
| DELETE | `/v1/connection` | Desconecta o banco e apaga os dados importados |
| GET | `/v1/status` | Modo, push ativo, IA, última sincronização |
| GET | `/v1/summary` | Saldo, entrou/saiu hoje, semana, série de 7 dias, 3 últimas |
| GET | `/v1/transactions?cursor&limit&from&to` | Lista paginada por cursor (datas `AAAA-MM-DD`) |
| POST | `/v1/sync` | Sincroniza agora (só leitura no agregador) |
| POST | `/v1/chat` | SSE: eventos `meta`, `delta`, `card`, `error`, `done`. Corpo `{messages:[{role,content}]}` |
| POST | `/v1/events/bank-notification` | Movimentação lida da notificação do banco: `{fingerprint, amountCents, counterpart?, method?, occurredAt, alreadyNotified?}` → provisória + aviso |
| POST | `/v1/devices` | `{fid}` — registra o aparelho para push |
| POST | `/v1/devices/test` | Envia um push de teste |
| GET | `/v1/notifications?after` | Outbox (fallback local) |
| GET/PUT | `/v1/settings` | `bigOutflowThresholdCents`, `dailySummaryTime` (HH:MM), `dailySummaryEnabled`, `notifyIncoming`, `notifyOutgoing` |
| POST | `/v1/webhooks/pluggy` | Webhook da Pluggy (assinatura/segredo) |
| POST | `/v1/dev/simulate` | Só em mock: `{direction?: "in"|"out", amountCents?}` |

---

### Licenças de terceiros

A fonte **Inter** (© The Inter Project Authors) é distribuída sob a SIL Open Font License 1.1 — cópia em `app/app/src/main/assets/licenses/inter-OFL.txt`.
