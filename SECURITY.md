# Política de Segurança

O Otto lida com dados financeiros, então levamos segurança a sério.

## Reportando uma vulnerabilidade

Se encontrou uma falha de segurança, **não abra uma issue pública**. Use o recurso [Report a vulnerability](https://github.com/stumdev/otto/security/advisories/new) do GitHub e descreva o problema com o máximo de detalhes possível (sem incluir dados reais de ninguém).

## O que já protege os dados

- **Senha do banco nunca passa pelo Otto**: a conexão é feita por Open Finance (Pluggy), só leitura.
- **Senhas de usuários** são guardadas com hash `scrypt` e sal; tokens de sessão são guardados só como SHA-256.
- **Um banco SQLite por usuário**: os dados financeiros de cada pessoa ficam isolados.
- **A IA nunca recebe o extrato**: só totais e, no máximo, 10 lançamentos por consulta.
- No app, o token fica cifrado no Android Keystore, com bloqueio por biometria e proteção de tela.

Detalhes na seção [Segurança do README](README.md#5-segurança).

## Boas práticas ao rodar o seu servidor

- Nunca versione `.env`, `secrets/` nem `google-services.json` (o `.gitignore` já cobre).
- Use HTTPS (Cloudflare Tunnel ou Caddy) antes de expor o servidor na internet; sem HTTPS, senhas e saldos trafegam sem criptografia.
- Defina `SIGNUP_CODE` se não quiser cadastro aberto.
- Faça backup e guarde-o cifrado: ele contém o histórico financeiro de todos os usuários.
