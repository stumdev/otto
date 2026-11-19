/**
 * Mostra no terminal um QR code com a URL do servidor e o token, para configurar o app
 * apontando a câmera (Primeira execução > "Ler QR code").
 *
 * ATENÇÃO: o QR contém o APP_TOKEN. Não tire print nem compartilhe. Nada é gravado em log.
 *
 * Uso: npm run setup-qr -- https://tony.seudominio.com
 */
import qrcode from 'qrcode-terminal';
import { loadDotEnv } from './env.js';

loadDotEnv();
const url = process.argv[2] ?? process.env['PUBLIC_BASE_URL'];
const token = process.env['APP_TOKEN'];
if (!url || !token) {
  console.error('Informe a URL (argumento ou PUBLIC_BASE_URL) e defina APP_TOKEN no .env.');
  process.exit(1);
}
const payload = `tony://setup?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
console.log(`\nServidor: ${url}\nAponte a câmera do app para o código abaixo. Não compartilhe esta tela.\n`);
qrcode.generate(payload, { small: true });
