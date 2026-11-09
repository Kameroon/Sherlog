import { useState } from 'react';
import type { ReactNode } from 'react';

interface FoldablePanelProps {
  /** Base of the ids that link the title to the panel and the button to its content. */
  id: string;
  title: string;
  /** Classes added to the panel, for the layout of the screen that uses it. */
  className?: string;
  children: ReactNode;
}

/**
 * A panel whose content the user can fold to make room, open at first. The title stays a heading and holds the button
 * (the disclosure pattern): a screen reader says "expanded" or "collapsed". The content is hidden, not removed, so
 * that what the user ticked or typed in it is still there when it is opened again.
 */
export function FoldablePanel({ id, title, className = '', children }: FoldablePanelProps) {
  const [open, setOpen] = useState(true);

  return (
    <section className={`panel foldable ${className}`.trim()} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="foldable-title">
        <button
          type="button"
          className="foldable-toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => {
            setOpen(!open);
          }}
        >
          <span>{title}</span>
          <span className="foldable-arrow" aria-hidden="true" />
        </button>
      </h2>
      <div id={`${id}-body`} className="foldable-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
