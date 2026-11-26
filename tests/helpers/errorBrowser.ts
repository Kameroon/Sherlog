import { fireEvent, screen, within } from '@testing-library/react';
import type { ErrorRecord } from '../../src/core/scanLog';
import type { EntryPosition, EntryText } from '../../src/sources/readEntryText';
import type { NeighbourLines } from '../../src/sources/readNeighbourLines';

/** The error number `index` of a log: one every 100 bytes, a second apart, so that its place in the list is predictable. */
export const record = (index: number, fingerprintId: number, timestamp: string | null = `2026-11-04 08:00:${String(index).padStart(2, '0')}`): ErrorRecord => ({
  offset: index * 100,
  length: 90,
  timestamp,
  level: 'ERR',
  message: `failure ${index}`,
  messageCut: false,
  lineCount: 1,
  fingerprintId,
});

/** What reading the entry of a record gives: a text that says where it was read. */
export const entryOf = (position: EntryPosition): EntryText => ({ text: `entry at ${position.offset}`, cut: false });

export const noLines: NeighbourLines = { before: [], after: [], beforeLimited: false, afterLimited: false };

/** The rows of the list of errors. */
export const rows = () => within(screen.getByRole('listbox', { name: 'Erreurs' })).getAllByRole('option');

/** Selects the error of a row, as a click does. */
export const select = (row: number): void => {
  fireEvent.click(rows()[row] as HTMLElement);
};
