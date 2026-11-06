import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('rendering failure');
  }
  return <p>child content</p>;
}

describe('ErrorBoundary', () => {
  it('should render its children when no error occurs', () => {
    // Arrange & Act
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );

    // Assert
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('should show an accessible fallback when a child throws during rendering', () => {
    // Arrange: React reports the caught error itself, which is noise in the test output.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Act
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('Une erreur est survenue');
  });

  it('should not display the error message when a child throws, to avoid leaking log content', () => {
    // Arrange
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Act
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    // Assert
    expect(screen.queryByText(/rendering failure/)).not.toBeInTheDocument();
  });

  it('should render the children again when the user retries after the cause is gone', () => {
    // Arrange
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldThrow = true;
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    rerender(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    // Assert
    expect(screen.getByText('child content')).toBeInTheDocument();
  });
});
