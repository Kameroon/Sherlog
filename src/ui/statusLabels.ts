import type { ErrorStatus } from '../core/errorStatus';

/** The statuses in the order they are offered, with the word the screen uses for each. */
export const STATUS_CHOICES: readonly { status: ErrorStatus; label: string }[] = [
  { status: 'new', label: 'Nouveau' },
  { status: 'analysed', label: 'Analysé' },
  { status: 'ignored', label: 'Ignoré' },
  { status: 'resolved', label: 'Résolu' },
];

export const labelOfStatus = (status: ErrorStatus): string => STATUS_CHOICES.find((choice) => choice.status === status)?.label ?? status;
