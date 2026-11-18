import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PREPARATION } from '../src/core/preparation';
import { BUILT_IN_PROFILES } from '../src/core/profiles';
import { FormatPanel } from '../src/ui/FormatPanel';
import { IgnoreTool } from '../src/ui/IgnoreTool';
import { PeriodTool } from '../src/ui/PeriodTool';

const profile = BUILT_IN_PROFILES[0] ?? null;

const tools = [
  {
    title: 'Format',
    ui: (
      <FormatPanel
        profile={profile}
        recognised={profile}
        unrecognisedReason={null}
        orphanLines={0}
        readsNothing={false}
        otherFormat={{ lines: 0, labels: [] }}
        complete
        onChange={vi.fn()}
      />
    ),
  },
  {
    title: 'Ignorer des entrées',
    ui: <IgnoreTool preparation={EMPTY_PREPARATION} onChange={vi.fn()} counts={[]} countsAreForTheBeginning={false} />,
  },
  {
    title: 'Période',
    ui: (
      <PeriodTool
        preparation={EMPTY_PREPARATION}
        onChange={vi.fn()}
        withDate={false}
        range={null}
        forTheBeginning={false}
        ignoredByPeriod={0}
        problem={null}
      />
    ),
  },
];

describe.each(tools)('$title panel', ({ title, ui }) => {
  it('should be open at first, with an arrow to fold it', () => {
    // Arrange / Act
    render(ui);

    // Assert
    expect(screen.getByRole('button', { name: title }).getAttribute('aria-expanded')).toBe('true');
  });

  it('should fold when its arrow is clicked', () => {
    // Arrange
    render(ui);

    // Act
    fireEvent.click(screen.getByRole('button', { name: title }));

    // Assert
    expect(screen.getByRole('button', { name: title }).getAttribute('aria-expanded')).toBe('false');
  });
});
