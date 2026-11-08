import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tip } from '../src/ui/Tip';

function setup() {
  render(
    <Tip text="Lance l’analyse sur votre ordinateur.">
      {(describedBy) => (
        <button type="button" aria-describedby={describedBy}>
          Analyser
        </button>
      )}
    </Tip>,
  );
  return screen.getByRole('button', { name: 'Analyser' });
}

describe('Tip', () => {
  it('should describe the button with the tooltip text', () => {
    // Act
    const button = setup();

    // Assert
    expect(button).toHaveAccessibleDescription('Lance l’analyse sur votre ordinateur.');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Lance l’analyse sur votre ordinateur.');
  });

  it('should give each tooltip its own id so that two tips on a page do not describe each other', () => {
    // Arrange
    render(
      <>
        <Tip text="Premier">{(id) => <button aria-describedby={id}>Un</button>}</Tip>
        <Tip text="Second">{(id) => <button aria-describedby={id}>Deux</button>}</Tip>
      </>,
    );

    // Assert
    expect(screen.getByRole('button', { name: 'Un' })).toHaveAccessibleDescription('Premier');
    expect(screen.getByRole('button', { name: 'Deux' })).toHaveAccessibleDescription('Second');
  });

  it('should close on Escape, as the guidelines for content shown on hover or focus require', () => {
    // Arrange
    const button = setup();

    // Act
    fireEvent.keyDown(button, { key: 'Escape' });

    // Assert
    expect(screen.getByRole('tooltip')).toHaveClass('is-dismissed');
  });

  it('should show again once the pointer leaves, after it was closed', () => {
    // Arrange
    const button = setup();
    fireEvent.keyDown(button, { key: 'Escape' });

    // Act
    fireEvent.mouseLeave(button.parentElement as HTMLElement);

    // Assert
    expect(screen.getByRole('tooltip')).not.toHaveClass('is-dismissed');
  });

  it('should show again once the focus leaves, after it was closed', () => {
    // Arrange
    const button = setup();
    button.focus();
    fireEvent.keyDown(button, { key: 'Escape' });

    // Act
    fireEvent.blur(button);

    // Assert
    expect(screen.getByRole('tooltip')).not.toHaveClass('is-dismissed');
  });

  it('should ignore the other keys', () => {
    // Arrange
    const button = setup();

    // Act
    fireEvent.keyDown(button, { key: 'a' });

    // Assert
    expect(screen.getByRole('tooltip')).not.toHaveClass('is-dismissed');
  });
});
