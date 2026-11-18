import type { DownloadError, UrlRefusal } from '../sources/urlSource';
import { formatSize } from './format';

export interface DownloadFailureContext {
  /** The address of this site (`window.location.origin`): the one the CORS rules of the storage have to allow. */
  readonly siteOrigin: string;
}

/**
 * The sentence for an address that is not taken, saying what to change. It never repeats the address: it may hold an access token.
 */
export function refusalMessage(reason: UrlRefusal, allowedHosts: readonly string[]): string {
  switch (reason) {
    case 'empty':
      return 'Collez l’adresse du fichier.';
    case 'malformed':
      return 'Ce n’est pas une adresse web valide.';
    case 'not-https':
      return 'L’adresse doit commencer par https:// : le jeton d’accès ne doit jamais circuler sans chiffrement.';
    case 'credentials':
      return 'L’adresse ne doit contenir ni nom d’utilisateur ni mot de passe avant le nom du compte.';
    case 'port':
      return 'L’adresse ne doit pas préciser de port.';
    case 'host':
      return `Ce compte de stockage n’est pas autorisé. Comptes autorisés : ${allowedHosts.join(', ')}. En ajouter un demande de modifier la configuration de l’application.`;
    case 'no-file':
      return 'L’adresse doit désigner un fichier (…/conteneur/fichier.log), pas un compte ni un conteneur.';
  }
}

const withStatus = (sentence: string, failure: DownloadError): string => (failure.status === undefined ? sentence : `${sentence} (code ${failure.status})`);

/**
 * Turns a failed download into a message for the user: what happened and, when there is something to do, what.
 * It holds nothing of the address: neither the file, nor the account, nor the token.
 */
export function downloadFailureMessage(failure: DownloadError, context: DownloadFailureContext): string {
  switch (failure.kind) {
    case 'unauthorized':
    case 'forbidden':
      return withStatus('Le stockage refuse l’accès à ce fichier : le jeton est invalide, expiré, ou sans droit de lecture. Générez-en un nouveau, en lecture seule.', failure);
    case 'not-found':
      return 'Fichier introuvable : vérifiez le nom du conteneur et du fichier dans l’adresse.';
    case 'rejected':
      return withStatus('Le stockage a refusé la demande.', failure);
    case 'rate-limited':
    case 'unavailable':
      return 'Le stockage ne peut pas répondre pour le moment. Réessayez plus tard.';
    case 'network':
      return `Le compte de stockage est injoignable depuis ce navigateur. Vérifiez la connexion réseau, et que les règles CORS du service Blob autorisent l’adresse de ce site (${context.siteOrigin}) pour les méthodes GET, HEAD et OPTIONS.`;
    case 'timeout':
      return 'Le stockage n’a pas répondu à temps.';
    case 'interrupted':
      return 'Le téléchargement s’est interrompu avant la fin : rien n’a été gardé.';
    case 'protocol':
      return 'La réponse du stockage n’a pas la forme attendue.';
    case 'cancelled':
      return 'Téléchargement annulé.';
    case 'too-large': {
      const limit = failure.limitBytes === undefined ? '' : formatSize(failure.limitBytes);
      return failure.announcedBytes === undefined
        ? `Le téléchargement a été arrêté : le fichier dépasse la limite de ${limit}. Rien n’a été gardé ; choisissez un fichier plus petit.`
        : `Ce fichier fait ${formatSize(failure.announcedBytes)}, au-delà de la limite de ${limit} : il n’a pas été téléchargé. Choisissez un fichier plus petit.`;
    }
  }
}
