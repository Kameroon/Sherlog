import type { AiRequestError } from './errors';
import { PROVIDER_NAMES } from './provider';
import type { ProviderId } from './provider';

export interface FailureContext {
  readonly provider: ProviderId;
  /** The address of this site (`window.location.origin`): the one Ollama has to be told to accept. */
  readonly siteOrigin: string;
}

/** What the provider said, for the end of a message: it is text from a third party, shown as text and never as markup. */
function withDetail(sentence: string, failure: AiRequestError): string {
  if (failure.detail !== undefined) {
    return `${sentence} (« ${failure.detail} »)`;
  }
  return failure.status === undefined ? sentence : `${sentence} (code ${failure.status})`;
}

/**
 * Turns a failed request into a message for the user: what happened and, when there is something to do, what.
 * It never holds a key (the provider's own words have it taken out) nor any text of a log.
 */
export function failureMessage(failure: AiRequestError, context: FailureContext): string {
  const name = PROVIDER_NAMES[context.provider];
  const ollama = context.provider === 'ollama';
  switch (failure.kind) {
    case 'unauthorized':
      return `La clé est refusée par ${name} : elle est invalide, expirée ou révoquée. Vérifiez-la ou créez-en une autre.`;
    case 'forbidden':
      return ollama
        ? `Ollama refuse l’adresse de ce site (${context.siteOrigin}). Ajoutez-la à la variable OLLAMA_ORIGINS, puis redémarrez Ollama.`
        : `${name} refuse l’accès avec cette clé : elle n’a pas les droits pour ce modèle ou cette organisation.`;
    case 'not-found':
      return withDetail(ollama ? 'Ce modèle n’est pas installé dans Ollama.' : `Ce modèle n’existe pas chez ${name} : vérifiez son identifiant.`, failure);
    case 'rejected':
      return withDetail(`${name} a refusé la demande.`, failure);
    case 'rate-limited':
      return `${name} limite les demandes, ou le crédit est épuisé. Réessayez plus tard ou vérifiez votre plafond de dépense.`;
    case 'unavailable':
      return withDetail(`${name} ne peut pas répondre pour le moment.`, failure);
    case 'network':
      return ollama
        ? `Ollama ne répond pas. Vérifiez qu’il est lancé sur cet ordinateur et qu’il accepte l’adresse de ce site : variable OLLAMA_ORIGINS contenant ${context.siteOrigin}, puis redémarrage d’Ollama. Si le navigateur demande l’accès aux appareils du réseau local, acceptez-le.`
        : `${name} est injoignable depuis ce navigateur : vérifiez la connexion réseau. Un pare-feu ou une extension peut aussi bloquer api.anthropic.com.`;
    case 'timeout':
      return `${name} n’a pas répondu à temps.`;
    case 'interrupted':
      return `La réponse de ${name} s’est interrompue avant la fin.`;
    case 'protocol':
      return withDetail(`La réponse de ${name} n’a pas la forme attendue.`, failure);
    case 'cancelled':
      return 'Demande annulée.';
  }
}
