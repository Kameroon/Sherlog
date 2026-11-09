import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { AnalysisOutcome } from '../ai/analyseError';
import { MAX_QUESTION_CHARS } from '../ai/chatPrompt';
import type { ProviderChoice } from '../ai/createProvider';
import { PROVIDER_NAMES } from '../ai/provider';
import { redact, rulesForSending } from '../core/redact';
import type { RedactionRuleId } from '../core/redact';
import { ExactText } from './ExactText';
import type { ExactTextProps } from './ExactText';
import { formatCount } from './format';
import type { ChatState } from './useChats';

/** What goes with the first question, before it is sent: the exact masked text of the log, and the analysis the model made of it. */
export function ChatContextPreview({ analysis, ...text }: ExactTextProps & { analysis: AnalysisOutcome }) {
  return (
    <>
      <ExactText {...text} />
      <p className="small-note">{analysis.kind === 'structured' ? 'Avec l’analyse faite par le modèle :' : 'Avec la réponse du modèle, qui n’a pas suivi le format attendu :'}</p>
      <pre className="entry-text" role="region" aria-label="Analyse jointe au contexte" tabIndex={0}>
        {analysis.kind === 'structured' ? JSON.stringify(analysis.analysis, null, 2) : analysis.text}
      </pre>
    </>
  );
}

interface ChatPanelProps {
  chat: ChatState;
  /** What the user chose in the settings, once it is usable; `null` until then. */
  provider: ProviderChoice | null;
  /** The masking rules the user chose in the preparation; the ones on by default are applied whatever they are. */
  masking: ReadonlySet<RedactionRuleId>;
  /** `true` while an answer is awaited, for this error or another. */
  busy: boolean;
  /** `true` while the answer awaited is for this error. */
  answering: boolean;
  /** How many errors share this one's fingerprint, since they share its conversation. */
  twins: number;
  /** The exact context that goes with the first question, shown on request. */
  context: ReactNode;
  onAsk: (question: string) => void;
  onStop: () => void;
  onClear: () => void;
}

const hiddenNote = (count: number): string => (count === 1 ? '1 donnée de ce message sera masquée.' : `${formatCount(count)} données de ce message seront masquées.`);

/**
 * The conversation about one error, which deepens the analysis the model made of it: the screen opens it only once the
 * model has answered for this error, and it needs a provider. Nothing is sent before the user clicks; each question is masked like the rest, and what is shown
 * in the conversation is what was sent. The answers are shown as text, as they are written.
 */
export function ChatPanel({ chat, provider, masking, busy, answering, twins, context, onAsk, onStop, onClear }: ChatPanelProps) {
  const id = useId();
  const [question, setQuestion] = useState('');
  const [contextShown, setContextShown] = useState(false);
  const hidden = redact(question, rulesForSending(masking)).count;
  const canAsk = provider !== null && !busy && question.trim() !== '';
  const exchanges = chat.pending === null ? chat.turns : [...chat.turns, { question: chat.pending.question, answer: chat.pending.answer }];

  const submit = (): void => {
    if (canAsk) {
      onAsk(question);
      setQuestion('');
    }
  };

  return (
    <section className="chat" aria-label="Discussion sur cette erreur">
      <h3>Discuter de cette erreur</h3>
      <p className="small-note">
        Le chat approfondit l’analyse du modèle ci-dessus pour cette erreur{twins > 1 ? ` et pour les ${formatCount(twins)} erreurs identiques` : ''}. Il s’appuie sur elle et sur le texte masqué de l’occurrence la plus récente ; il ne doit rien inventer et dit ce qui lui manque.
      </p>
      <p className="small-note">
        {provider === null
          ? 'Choisissez un fournisseur et donnez sa clé dans les réglages de « Envoi à l’IA » pour discuter.'
          : `Chaque message part vers ${provider.provider === 'anthropic' ? 'Anthropic (api.anthropic.com)' : `${PROVIDER_NAMES.ollama} sur cet ordinateur (localhost:11434)`}, modèle ${provider.model}, avec toute la conversation. Rien n’est envoyé avant le clic.`}
      </p>
      <div className="chat-context">
        <button type="button" className="button-secondary" aria-expanded={contextShown} aria-controls={`${id}-context`} onClick={() => setContextShown(!contextShown)}>
          {contextShown ? 'Masquer le contexte envoyé' : 'Voir le contexte envoyé avec la première question'}
        </button>
        <div id={`${id}-context`}>{contextShown && context}</div>
      </div>

      {exchanges.length > 0 && (
        <ol className="chat-thread" aria-label="Conversation">
          {exchanges.map((exchange, index) => (
            <li key={index} className="chat-turn">
              <p className="chat-who">Vous</p>
              <p className="chat-text">{exchange.question}</p>
              <p className="chat-who">Modèle</p>
              <p className="chat-text">{exchange.answer === '' ? '…' : exchange.answer}</p>
            </li>
          ))}
        </ol>
      )}
      {/* The answer is written piece by piece: only the start and the end are announced, not each piece. */}
      <p className="visually-hidden" role="status">
        {answering ? 'Le modèle répond…' : ''}
      </p>

      {chat.failure !== null && (
        <div className="chat-failure">
          <p className="notice notice-error" role="alert">
            {chat.failure.message}
          </p>
          {!busy && (
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                if (provider !== null && chat.failure !== null) {
                  onAsk(chat.failure.question);
                }
              }}
              disabled={provider === null}
            >
              Réessayer
            </button>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor={`${id}-question`}>Votre question</label>
        <textarea
          id={`${id}-question`}
          className="text-area"
          rows={3}
          maxLength={MAX_QUESTION_CHARS}
          value={question}
          disabled={answering}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
        />
        {hidden > 0 && <p className="small-note">{hiddenNote(hidden)}</p>}
      </div>
      <div className="actions">
        <button type="button" className="button-primary" disabled={!canAsk} onClick={submit}>
          Envoyer la question
        </button>
        {answering && (
          <button type="button" className="button-secondary" onClick={onStop}>
            Arrêter la réponse
          </button>
        )}
        {(chat.turns.length > 0 || chat.failure !== null) && !answering && (
          <button type="button" className="button-link" onClick={onClear}>
            Effacer la conversation
          </button>
        )}
      </div>
    </section>
  );
}
