import { useCallback, useEffect, useRef, useState } from 'react';
import type { Analysis } from '../ai/analysis';
import { buildChatRequest } from '../ai/chatPrompt';
import type { ChatContext, ChatTurn } from '../ai/chatPrompt';
import { createProvider } from '../ai/createProvider';
import type { ProviderChoice } from '../ai/createProvider';
import { AiRequestError } from '../ai/errors';
import { failureMessage } from '../ai/failureMessage';
import { MAX_ANSWER_CHARS } from '../ai/provider';
import type { IdenticalErrors } from '../core/identicalErrors';
import { redact, rulesForSending } from '../core/redact';
import type { RedactionRuleId } from '../core/redact';
import type { ErrorRecord } from '../core/scanLog';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import type { NeighbourLines } from '../sources/readNeighbourLines';
import { readPayload } from './readPayload';

/** What a chat holds about one error: the exchanges, the one under way, and why the last question did not go through. */
export interface ChatState {
  /** The complete exchanges, oldest first; the questions are as they were sent, masked. */
  readonly turns: readonly ChatTurn[];
  /** What the chat knows of the error, built when the first question is sent and kept for the conversation. */
  readonly context: ChatContext | null;
  /** The question being answered (masked) and the answer so far. */
  readonly pending: { readonly question: string; readonly answer: string } | null;
  /** Why the last question did not get an answer; `question` is what the user typed, to try again. */
  readonly failure: { readonly message: string; readonly question: string } | null;
}

export const NEW_CHAT: ChatState = { turns: [], context: null, pending: null, failure: null };

/** What the chats read of the analysis session; given afresh at each render, read when it is needed. */
export interface ChatsInputs {
  readonly records: readonly ErrorRecord[];
  readonly groups: ReadonlyMap<number, IdenticalErrors>;
  readonly fileName: string;
  readonly hasDate: boolean;
  readonly countIsMinimum: boolean;
  readonly readText: (position: EntryPosition) => Promise<EntryText>;
  readonly readNeighbours: (position: EntryPosition) => Promise<NeighbourLines>;
  readonly fetchImpl?: typeof fetch;
  readonly siteOrigin: string;
  /** The analysis the model made of an error, if it made one: it goes into the context of the chat. */
  readonly analysisOf: (fingerprintId: number) => Analysis | null;
}

/** One question the user asked: with the conversation and the provider as they were at that moment. */
interface Job {
  readonly fingerprintId: number;
  readonly choice: ProviderChoice;
  readonly masking: ReadonlySet<RedactionRuleId>;
  /** What the user typed. */
  readonly typed: string;
  /** What is sent of it. */
  readonly question: string;
  readonly turns: readonly ChatTurn[];
  readonly context: ChatContext | null;
}

export interface Chats {
  readonly chats: ReadonlyMap<number, ChatState>;
  /** The fingerprint whose answer is being awaited, or `null`. */
  readonly busy: number | null;
  readonly ask: (fingerprintId: number, typed: string, choice: ProviderChoice, masking: ReadonlySet<RedactionRuleId>) => void;
  readonly stop: () => void;
  readonly clear: (fingerprintId: number) => void;
}

const TOO_LONG = 'La conversation est trop longue pour être envoyée en entier : effacez-la pour recommencer.';

/**
 * The conversations about the errors, one per fingerprint (so shared by the errors identical to each other), kept in
 * memory. A question is sent when the user asks, masked like everything else that leaves, with the whole conversation;
 * the answer is shown as it is written. A question that gets no answer (a failure, or the user stopping it) leaves the
 * conversation as it was, with what was typed to try again. Only one answer is awaited at a time.
 */
export function useChats(inputs: ChatsInputs): Chats {
  const [chats, setChats] = useState<ReadonlyMap<number, ChatState>>(new Map());
  const [job, setJob] = useState<Job | null>(null);

  // The run reads the latest inputs when it needs them: restarting it at each render would cancel the request under way.
  const latest = useRef(inputs);
  useEffect(() => {
    latest.current = inputs;
  });

  const update = useCallback((fingerprintId: number, change: (previous: ChatState) => ChatState): void => {
    setChats((previous) => new Map(previous).set(fingerprintId, change(previous.get(fingerprintId) ?? NEW_CHAT)));
  }, []);

  useEffect(() => {
    if (job === null) {
      return undefined;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const { fingerprintId } = job;
    const fail = (message: string): void => {
      update(fingerprintId, (chat) => ({ ...chat, pending: null, failure: { message, question: job.typed } }));
    };

    const run = async (): Promise<void> => {
      update(fingerprintId, (chat) => ({ ...chat, pending: { question: job.question, answer: '' }, failure: null }));
      const { records, groups, fileName, hasDate, countIsMinimum, readText, readNeighbours, fetchImpl, siteOrigin, analysisOf } = latest.current;

      let context = job.context;
      if (context === null) {
        const read = await readPayload({ records, groups, fingerprintId, hasDate, fileName, countIsMinimum, readText, readNeighbours }, job.masking, signal);
        if (!read.ok) {
          // Given up (the user stopped it): the screen already says so.
          if (!read.aborted) {
            fail(read.message);
          }
          return;
        }
        context = { payload: read.payload, analysis: analysisOf(fingerprintId) };
        const built = context;
        update(fingerprintId, (chat) => ({ ...chat, context: built }));
      }

      try {
        const built = buildChatRequest({ context, turns: job.turns, question: job.question });
        if (!built.ok) {
          fail(TOO_LONG);
          return;
        }
        let answer = '';
        for await (const piece of createProvider(job.choice, fetchImpl).stream(built.request.messages, { system: built.request.system, signal })) {
          answer += piece;
          if (answer.length > MAX_ANSWER_CHARS) {
            throw new AiRequestError('protocol', { detail: 'réponse trop longue' });
          }
          const soFar = answer;
          update(fingerprintId, (chat) => (chat.pending === null ? chat : { ...chat, pending: { question: job.question, answer: soFar } }));
        }
        if (signal.aborted) {
          return;
        }
        if (answer.trim() === '') {
          fail('Le modèle n’a rien répondu.');
          return;
        }
        const complete = answer;
        update(fingerprintId, (chat) => ({ ...chat, turns: [...chat.turns, { question: job.question, answer: complete }], pending: null, failure: null }));
      } catch (error) {
        if (signal.aborted || (error instanceof AiRequestError && error.kind === 'cancelled')) {
          return;
        }
        fail(error instanceof AiRequestError ? failureMessage(error, { provider: job.choice.provider, siteOrigin }) : 'Erreur inattendue pendant la discussion.');
      }
    };

    void run().then(() => {
      if (!signal.aborted) {
        setJob(null);
      }
    });
    return () => {
      controller.abort();
    };
  }, [job, update]);

  const ask = useCallback(
    (fingerprintId: number, typed: string, choice: ProviderChoice, masking: ReadonlySet<RedactionRuleId>): void => {
      const chat = chats.get(fingerprintId) ?? NEW_CHAT;
      // What is typed is masked here, with the rules chosen and always the ones on by default: nothing a user pastes leaves as it is.
      const question = redact(typed.trim(), rulesForSending(masking)).text;
      setJob({ fingerprintId, choice, masking, typed, question, turns: chat.turns, context: chat.context });
    },
    [chats],
  );

  const stop = useCallback((): void => {
    if (job === null) {
      return;
    }
    // Stopped, the question is given back to the user to try again: nothing of the answer so far is kept.
    update(job.fingerprintId, (chat) => ({ ...chat, pending: null, failure: { message: 'Vous avez arrêté la réponse : la question n’a pas été gardée.', question: job.typed } }));
    setJob(null);
  }, [job, update]);

  const clear = useCallback((fingerprintId: number): void => {
    setChats((previous) => {
      const next = new Map(previous);
      next.delete(fingerprintId);
      return next;
    });
  }, []);

  return { chats, busy: job === null ? null : job.fingerprintId, ask, stop, clear };
}
