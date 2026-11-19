import { readFileSync } from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import type { PushMessage, PushResult, PushSender } from './notifier.js';
import { disabledPushSender } from './notifier.js';

/**
 * Push via Firebase Cloud Messaging (API HTTP v1, pelo Admin SDK oficial).
 *
 * O FCM está migrando de "registration tokens" para Firebase Installation IDs (FIDs);
 * o app registra o FID recebido em onRegistered() e aqui enviamos com `fids`
 * (https://firebase.google.com/docs/cloud-messaging/manage-tokens).
 *
 * Mensagens são só de dados (data-only, prioridade alta): o app monta a notificação
 * localmente, com o canal certo (entradas/saidas/resumo) e o toque abrindo a tela certa.
 */
export async function createFcmSender(file: string | undefined, log: FastifyBaseLogger): Promise<PushSender> {
  if (!file) {
    log.info('FCM não configurado (FIREBASE_SERVICE_ACCOUNT_FILE vazio): o app usará notificação local por polling');
    return disabledPushSender;
  }
  let serviceAccount: Record<string, string>;
  try {
    serviceAccount = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  } catch (err) {
    log.error({ err: (err as Error).message }, 'não foi possível ler o arquivo da conta de serviço do Firebase; FCM desligado');
    return disabledPushSender;
  }

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getMessaging } = await import('firebase-admin/messaging');
  const app = initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount['project_id'] }, 'otto');
  const messaging = getMessaging(app);
  log.info('FCM habilitado');

  return {
    enabled: true,
    async send(fids: string[], msg: PushMessage): Promise<PushResult> {
      const invalidTokens: string[] = [];
      let successCount = 0;
      // limite do FCM: 500 destinos por chamada
      for (let i = 0; i < fids.length; i += 500) {
        const chunk = fids.slice(i, i + 500);
        const res = await messaging.sendEachForMulticast({
          fids: chunk,
          data: {
            id: String(msg.id),
            kind: msg.kind,
            title: msg.title,
            body: msg.body,
            target: msg.target,
          },
          android: { priority: 'high', ttl: 24 * 60 * 60 * 1000 },
        });
        successCount += res.successCount;
        res.responses.forEach((r, idx) => {
          const code = r.error?.code ?? '';
          if (code.endsWith('not-registered') || code.endsWith('invalid-registration-token')) {
            invalidTokens.push(chunk[idx]!);
          } else if (r.error) {
            log.warn({ code }, 'FCM recusou uma mensagem');
          }
        });
      }
      return { successCount, invalidTokens };
    },
  };
}
