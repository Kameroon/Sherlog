import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from '../src/ui/Logo';

describe('Logo', () => {
  it('should show the application name', () => {
    // Arrange & Act
    render(<Logo />);

    // Assert
    expect(screen.getByText('Sherlog')).toBeInTheDocument();
  });

  it('should hide the decorative mark from assistive technologies', () => {
    // Arrange & Act
    const { container } = render(<Logo />);

    // Assert
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
