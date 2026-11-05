/**
 * Pedido do aluno, pelo WhatsApp, para retirar a autorização das fotos do corpo (LGPD art. 8º,
 * §5º). Reconhecimento por regras determinísticas, antes de qualquer modelo: um pedido de
 * privacidade nunca depende de a IA entender a frase. Reconhecer só abre a confirmação; apagar
 * exige um "sim" explícito logo em seguida.
 */
import { foldText } from '../../core/attendance-rules/text-normalize';

/** De quem são as fotos: as do corpo do aluno, ou a autorização delas. */
const PHOTO_SUBJECT =
  /\b(minhas? fotos?|fotos? (do|de) (meu )?corpo|fotos? corporais?|(autorizacao|consentimento|permissao) (d\w+ |para |de )?fotos?|uso d\w+ fotos?)\b/;

/** O que ele quer fazer com elas. */
const REVOKE_ACTION =
  /\b(apag\w*|exclu\w*|delet\w*|remov\w*|retir\w*|revog\w*|cancel\w*|tire|tirar|tira|nao autorizo|nao quero mais)\b/;

/** "Quero apagar minhas fotos", "retirar a autorização das fotos", "não quero mais que usem minhas fotos". */
export function asksToRevokePhotoConsent(text: string): boolean {
  const folded = foldText(text);
  return PHOTO_SUBJECT.test(folded) && REVOKE_ACTION.test(folded);
}

const YES = /^(sim|s|confirmo|confirmado|pode( sim| apagar)?|apague|apaga|quero|isso|claro)\b/;
const NO = /^(nao|n|cancela\w*|deixa|melhor nao|manter|mantenha|mantem)\b/;

/** `true` = confirmou, `false` = recusou, `null` = outra coisa (a conversa segue normal). */
export function answersConfirmation(text: string): boolean | null {
  const folded = foldText(text).trim();
  if (YES.test(folded)) return true;
  if (NO.test(folded)) return false;
  return null;
}

export const PHOTO_REVOCATION_CONFIRM_MESSAGE =
  'Posso apagar as fotos do seu corpo e encerrar a autorização de uso delas? É definitivo: as fotos já enviadas são apagadas e deixam de ser usadas nas suas avaliações. Seu treino e seu plano continuam normais. Responda SIM para confirmar ou NÃO para manter tudo como está.';

export const PHOTO_REVOCATION_DONE_MESSAGE =
  'Pronto: apaguei as suas fotos e encerrei a autorização. Seu treino e seu plano seguem normalmente. Se mudar de ideia, é só me avisar.';

export const PHOTO_REVOCATION_DECLINED_MESSAGE = 'Tudo bem, deixei tudo como estava.';

export const PHOTO_REVOCATION_NOTHING_MESSAGE =
  'Não encontrei uma autorização de fotos ativa na sua conta, então não há fotos suas para apagar. Se quiser que eu confira outra coisa, é só dizer.';

export const PHOTO_REVOCATION_FAILED_MESSAGE =
  'Não consegui concluir agora. Tente de novo em alguns minutos; se continuar, a equipe da MOVIVO resolve com você por aqui.';
