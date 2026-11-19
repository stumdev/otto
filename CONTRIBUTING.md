# Contribuindo com o Otto

Obrigado por querer ajudar! Qualquer contribuição é bem-vinda: bugs, ideias, documentação e código.

## Preparando o ambiente

Você vai precisar de **Node.js 22+** (24 recomendado), **JDK 17** e do Android SDK (ou Android Studio) para o app.

```bash
git clone https://github.com/stumdev/otto.git
cd otto

# servidor (modo mock: não precisa de nenhuma chave)
cd server
npm ci
cp ../.env.example ../.env       # MOCK_MODE=true já vem ligado
npm run dev

# app Android (em outro terminal)
cd app
./gradlew assembleDebug          # debug aponta para http://10.0.2.2:8080 (emulador)
```

Com `MOCK_MODE=true`, o servidor gera dados fictícios e o app mostra um botão **Usar conta de demonstração**. Veja o [README](README.md#2-rodar-em-modo-mock-sem-nenhuma-chave) para o passo a passo.

## Fluxo

1. Faça um fork e crie uma branch: `git checkout -b minha-mudanca`.
2. Faça a mudança, com testes quando fizer sentido.
3. Rode as verificações:
   - servidor: `npm run typecheck && npm test` (em `server/`);
   - app: `./gradlew testDebugUnitTest assembleDebug` (em `app/`).
4. Abra um Pull Request explicando o que mudou e por quê.

Use [Conventional Commits](https://www.conventionalcommits.org/pt-br/) nas mensagens (`feat:`, `fix:`, `docs:`, `chore:`).

## Boas práticas

- Textos do app e documentação em português do Brasil.
- Valores em dinheiro sempre em **centavos (inteiros)**; datas "de hoje/semana/mês" no fuso `America/Sao_Paulo`.
- A IA só pode receber agregados e poucos lançamentos (veja [Privacidade](README.md#4-privacidade-o-que-a-ia-recebe)); não mande o extrato bruto.
- **Nunca commite** chaves de API, `.env`, `google-services.json`, bancos `.db` ou dados bancários reais.
- Mantenha as dependências fixadas em versões exatas.
