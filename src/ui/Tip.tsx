import { useId, useState } from 'react';
import type { ReactNode } from 'react';

interface TipProps {
  /** What the tooltip says: what the control does and what it does not do. */
  text: string;
  /** Renders the control; it must put `describedBy` in its `aria-describedby`. */
  children: (describedBy: string) => ReactNode;
}

/**
 * A control with a tooltip, shown on hover and on keyboard focus. Escape closes it (content that appears on hover or
 * focus must be dismissable without moving the pointer or the focus, WCAG 1.4.13) and it comes back the next time the
 * pointer or the focus enters. The text is also the control's accessible description.
 */
export function Tip({ text, children }: TipProps) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);

  return (
    <span
      className="has-tip"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setDismissed(true);
        }
      }}
      onMouseLeave={() => {
        setDismissed(false);
      }}
      onBlur={() => {
        setDismissed(false);
      }}
    >
      {children(id)}
      <span role="tooltip" id={id} className={dismissed ? 'tooltip is-dismissed' : 'tooltip'}>
        {text}
      </span>
    </span>
  );
}
