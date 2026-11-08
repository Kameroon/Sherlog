import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { IdenticalErrors } from '../core/identicalErrors';
import type { ErrorRecord } from '../core/scanLog';

/** Rows in one block of the list. Only the blocks near the window hold real rows (see {@link ErrorList}). */
export const ROWS_PER_CHUNK = 50;

// jsdom, which runs the tests, has no layout: it reports zero heights. These stand in for what a browser measures.
const FALLBACK_ROW_PX = 44;
const FALLBACK_VIEWPORT_PX = 600;

interface ErrorListProps {
  records: readonly ErrorRecord[];
  /** What the errors that share a fingerprint have in common; see `summariseIdentical`. */
  groups: ReadonlyMap<number, IdenticalErrors>;
  /** Index of the row whose detail is shown, or `null`. */
  selected: number | null;
  onSelect: (index: number) => void;
}

/**
 * The errors, one row each, as a list that holds as many as were recorded (up to a hundred thousand) without a row
 * per error in the page. The list is cut into blocks of {@link ROWS_PER_CHUNK} rows that all have the same height, set
 * by a style class: the blocks near the window hold real rows, the others are empty space of the same height, and the
 * last block is always real since it has fewer rows. No style is computed in script: the content security policy
 * forbids inline styles, and scroll positions are only read.
 *
 * It follows the listbox pattern: the focus stays on the list, `aria-activedescendant` names the active row (its block
 * is always in the page), and every row says its position in the whole list. The arrows, Home, End and the page keys
 * move the active row; Enter, Space or a click select it, which is what makes its detail appear.
 */
export function ErrorList({ records, groups, selected, onSelect }: ErrorListProps) {
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const firstChunkRef = useRef<HTMLDivElement>(null);
  const [firstVisibleChunk, setFirstVisibleChunk] = useState(0);
  const [active, setActive] = useState(0);
  const [metrics, setMetrics] = useState({ chunkPx: ROWS_PER_CHUNK * FALLBACK_ROW_PX, viewportPx: FALLBACK_VIEWPORT_PX });

  // Measured, not assumed: the height of a row follows the size of the text.
  useLayoutEffect(() => {
    const measure = (): void => {
      const chunkPx = firstChunkRef.current?.offsetHeight || ROWS_PER_CHUNK * FALLBACK_ROW_PX;
      const viewportPx = listRef.current?.clientHeight || FALLBACK_VIEWPORT_PX;
      setMetrics((previous) => (previous.chunkPx === chunkPx && previous.viewportPx === viewportPx ? previous : { chunkPx, viewportPx }));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [records.length]);

  const total = records.length;
  const chunkCount = Math.ceil(total / ROWS_PER_CHUNK);
  const rowPx = metrics.chunkPx / ROWS_PER_CHUNK;
  const lastVisibleChunk = firstVisibleChunk + Math.ceil(metrics.viewportPx / metrics.chunkPx);
  const activeChunk = Math.floor(active / ROWS_PER_CHUNK);
  const optionId = (index: number): string => `${listId}-option-${index}`;

  function moveTo(target: number): void {
    const index = Math.min(Math.max(target, 0), total - 1);
    setActive(index);
    const list = listRef.current;
    if (list === null) {
      return;
    }
    const rowTop = index * rowPx;
    const current = list.scrollTop;
    let next = current;
    if (rowTop < current) {
      next = rowTop;
    } else if (rowTop + rowPx > current + metrics.viewportPx) {
      next = rowTop + rowPx - metrics.viewportPx;
    }
    if (next !== current) {
      list.scrollTop = next;
      setFirstVisibleChunk(Math.floor(next / metrics.chunkPx));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const page = Math.max(1, Math.floor(metrics.viewportPx / rowPx) - 1);
    switch (event.key) {
      case 'ArrowDown':
        moveTo(active + 1);
        break;
      case 'ArrowUp':
        moveTo(active - 1);
        break;
      case 'PageDown':
        moveTo(active + page);
        break;
      case 'PageUp':
        moveTo(active - page);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(total - 1);
        break;
      case 'Enter':
      case ' ':
        onSelect(active);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const chunks = Array.from({ length: chunkCount }, (_, chunk) => {
    const isReal = (chunk >= firstVisibleChunk - 1 && chunk <= lastVisibleChunk + 1) || chunk === activeChunk || chunk === chunkCount - 1;
    const ref = chunk === 0 ? firstChunkRef : undefined;
    if (!isReal) {
      return <div key={chunk} ref={ref} role="presentation" aria-hidden="true" className="error-chunk error-chunk-empty" />;
    }
    const start = chunk * ROWS_PER_CHUNK;
    return (
      <div key={chunk} ref={ref} role="presentation" className="error-chunk">
        {records.slice(start, start + ROWS_PER_CHUNK).map((record, offset) => {
          const index = start + offset;
          const count = groups.get(record.fingerprintId)?.count ?? 1;
          const classes = ['error-option'];
          if (index === selected) {
            classes.push('is-selected');
          }
          if (index === active) {
            classes.push('is-active');
          }
          return (
            <div
              key={record.offset}
              id={optionId(index)}
              role="option"
              aria-selected={index === selected}
              aria-setsize={total}
              aria-posinset={index + 1}
              className={classes.join(' ')}
              onClick={() => {
                setActive(index);
                onSelect(index);
              }}
            >
              {record.timestamp !== null && <span className="error-time">{record.timestamp}</span>}
              <span className="error-level">{record.level}</span>
              {count > 1 && (
                <span className="badge">
                  ×{count}
                  <span className="visually-hidden"> identiques</span>
                </span>
              )}
              <span className="error-first-line">{`${record.message}${record.messageCut ? '…' : ''}`}</span>
            </div>
          );
        })}
      </div>
    );
  });

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Erreurs"
      aria-activedescendant={optionId(active)}
      tabIndex={0}
      className="error-list"
      onScroll={(event) => {
        setFirstVisibleChunk(Math.floor(event.currentTarget.scrollTop / metrics.chunkPx));
      }}
      onKeyDown={onKeyDown}
    >
      {chunks}
    </div>
  );
}
