import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { summariseIdentical } from '../src/core/identicalErrors';
import type { ErrorRecord } from '../src/core/scanLog';
import { ErrorList, ROWS_PER_CHUNK } from '../src/ui/ErrorList';

const record = (index: number, fingerprintId = index): ErrorRecord => ({
  offset: index * 100,
  length: 90,
  timestamp: `08:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`,
  level: 'ERR',
  message: `failure number ${index}`,
  messageCut: false,
  lineCount: 1,
  fingerprintId,
});

const recordsOf = (count: number, fingerprintOf: (index: number) => number = (index) => index): ErrorRecord[] =>
  Array.from({ length: count }, (_, index) => record(index, fingerprintOf(index)));

function setup(records: readonly ErrorRecord[], selected: number | null = null, onSelect = vi.fn<(index: number) => void>()) {
  render(<ErrorList records={records} groups={summariseIdentical(records)} selected={selected} onSelect={onSelect} />);
  return { list: screen.getByRole('listbox', { name: 'Erreurs' }), onSelect };
}

/** jsdom has no layout: the scroll position is faked on the element, as a browser would report it. */
function scrollTo(list: HTMLElement, scrollTop: number) {
  Object.defineProperty(list, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
  fireEvent.scroll(list);
}

const position = (option: HTMLElement) => Number(option.getAttribute('aria-posinset'));
const shownPositions = () => screen.queryAllByRole('option').map(position);
const active = (list: HTMLElement) => document.getElementById(list.getAttribute('aria-activedescendant') ?? '');

describe('ErrorList windowing', () => {
  it('should put every row in the page when there are few errors', () => {
    // Act
    setup(recordsOf(ROWS_PER_CHUNK - 1));

    // Assert
    expect(screen.getAllByRole('option')).toHaveLength(ROWS_PER_CHUNK - 1);
  });

  it('should keep a hundred thousand errors down to a few hundred rows in the page', () => {
    // Act
    setup(recordsOf(100_000));

    // Assert
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(ROWS_PER_CHUNK * 5);
  });

  it('should tell the position of each row in the whole list and the size of the whole list', () => {
    // Act
    setup(recordsOf(100_000));

    // Assert
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveAttribute('aria-posinset', '1');
    expect(first).toHaveAttribute('aria-setsize', '100000');
  });

  it('should show the rows around the scroll position and none of the far ones when the user scrolls far', () => {
    // Arrange
    const { list } = setup(recordsOf(100_000));

    // Act
    scrollTo(list, 1000 * ROWS_PER_CHUNK * 44);

    // Assert: the blocks around the position, the active row's block and the last block are in the page.
    const shown = shownPositions();
    expect(shown).toContain(1000 * ROWS_PER_CHUNK + 1);
    expect(shown).not.toContain(500 * ROWS_PER_CHUNK + 1);
    expect(shown.length).toBeLessThanOrEqual(ROWS_PER_CHUNK * 6);
  });

  it('should always have the last rows, which fill a block only partly, in the page', () => {
    // Act
    setup(recordsOf(100_000 - 7));

    // Assert
    expect(shownPositions()).toContain(100_000 - 7);
  });

  it('should show the rows of the last block when the list has no full block to leave empty', () => {
    // Act
    setup(recordsOf(ROWS_PER_CHUNK * 2 + 3));

    // Assert
    expect(shownPositions()).toHaveLength(ROWS_PER_CHUNK * 2 + 3);
  });
});

describe('ErrorList rows', () => {
  it('should show the time, the level and the start of the message as text', () => {
    // Act
    setup([{ ...record(0), message: 'Failed <img src=x onerror=alert(1)>' }]);

    // Assert
    const option = screen.getByRole('option');
    expect(option).toHaveTextContent('08:00:00');
    expect(option).toHaveTextContent('ERR');
    expect(option).toHaveTextContent('Failed <img src=x onerror=alert(1)>');
    expect(option.querySelector('img')).toBeNull();
  });

  it('should mark a message that was cut with an ellipsis', () => {
    // Act
    setup([{ ...record(0), message: 'long message', messageCut: true }]);

    // Assert
    expect(screen.getByRole('option')).toHaveTextContent('long message…');
  });

  it('should leave the time out for an entry without one', () => {
    // Act
    setup([{ ...record(0), timestamp: null }]);

    // Assert
    expect(screen.getByRole('option').querySelector('.error-time')).toBeNull();
  });

  it('should show how many identical errors there are, for errors that have twins only', () => {
    // Arrange
    const records = [record(0, 5), record(1, 5), record(2, 5), record(3, 9)];

    // Act
    setup(records);

    // Assert
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('×3 identiques');
    expect(options[2]).toHaveTextContent('×3 identiques');
    expect(options[3]).not.toHaveTextContent('identiques');
  });

  it('should mark the selected row as selected', () => {
    // Act
    setup(recordsOf(5), 2);

    // Assert
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false', 'false']);
  });

  it('should select a row when the user clicks it', () => {
    // Arrange
    const { onSelect } = setup(recordsOf(5));

    // Act
    fireEvent.click(screen.getAllByRole('option')[3] as HTMLElement);

    // Assert
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});

describe('ErrorList keyboard', () => {
  it('should start on the first row', () => {
    // Act
    const { list } = setup(recordsOf(100));

    // Assert
    expect(active(list)).toHaveAttribute('aria-posinset', '1');
  });

  it('should move the active row with the arrows, without going past either end', () => {
    // Arrange
    const { list } = setup(recordsOf(3));

    // Act
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    const atTop = position(active(list) as HTMLElement);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });

    // Assert
    expect([atTop, position(active(list) as HTMLElement)]).toEqual([1, 3]);
  });

  it('should go to the first and to the last row with Home and End', () => {
    // Arrange
    const { list } = setup(recordsOf(100_000));

    // Act
    fireEvent.keyDown(list, { key: 'End' });
    const last = position(active(list) as HTMLElement);
    fireEvent.keyDown(list, { key: 'Home' });

    // Assert
    expect([last, position(active(list) as HTMLElement)]).toEqual([100_000, 1]);
  });

  it('should move by a page with PageDown and PageUp', () => {
    // Arrange
    const { list } = setup(recordsOf(1000));

    // Act
    fireEvent.keyDown(list, { key: 'PageDown' });
    const afterDown = position(active(list) as HTMLElement);
    fireEvent.keyDown(list, { key: 'PageUp' });

    // Assert
    expect(afterDown).toBeGreaterThan(5);
    expect(position(active(list) as HTMLElement)).toBe(1);
  });

  it('should keep the active row in the page when the user scrolls far away from it', () => {
    // Arrange
    const { list } = setup(recordsOf(10_000));
    for (let press = 0; press < 10; press += 1) {
      fireEvent.keyDown(list, { key: 'PageDown' });
    }
    const before = position(active(list) as HTMLElement);

    // Act
    scrollTo(list, 150 * ROWS_PER_CHUNK * 44);

    // Assert: the focus is on the list and it names the active row, so that row must still exist.
    expect(before).toBeGreaterThan(ROWS_PER_CHUNK * 2);
    expect(active(list)).toBeInTheDocument();
    expect(position(active(list) as HTMLElement)).toBe(before);
  });

  it('should select the active row with Enter and with Space', () => {
    // Arrange
    const { list, onSelect } = setup(recordsOf(5));
    fireEvent.keyDown(list, { key: 'ArrowDown' });

    // Act
    fireEvent.keyDown(list, { key: 'Enter' });
    fireEvent.keyDown(list, { key: ' ' });

    // Assert
    expect(onSelect.mock.calls).toEqual([[1], [1]]);
  });

  it('should not select anything when the user only moves', () => {
    // Arrange
    const { list, onSelect } = setup(recordsOf(5));

    // Act
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'End' });

    // Assert
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('should leave the other keys alone so that the user can still tab out of the list', () => {
    // Arrange
    const { list } = setup(recordsOf(5));

    // Act
    const notPrevented = fireEvent.keyDown(list, { key: 'Tab' });

    // Assert
    expect(notPrevented).toBe(true);
  });

  it('should be reachable by keyboard, as one stop that holds the whole list', () => {
    // Act
    const { list } = setup(recordsOf(100_000));

    // Assert
    expect(list).toHaveAttribute('tabindex', '0');
    expect(screen.getAllByRole('option').every((option) => !option.hasAttribute('tabindex'))).toBe(true);
  });
});
