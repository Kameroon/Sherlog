import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FoldablePanel } from '../src/ui/FoldablePanel';

const toggle = () => screen.getByRole('button', { name: 'Réglages' });
const content = () => screen.getByText('Contenu du bloc');

function renderPanel() {
  render(
    <FoldablePanel id="panel" title="Réglages">
      <p>Contenu du bloc</p>
    </FoldablePanel>,
  );
}

describe('FoldablePanel', () => {
  it('should show its content and say it is expanded when it is first shown', () => {
    // Arrange / Act
    renderPanel();

    // Assert
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(content().closest('[hidden]')).toBeNull();
  });

  it('should hide its content when the arrow is clicked', () => {
    // Arrange
    renderPanel();

    // Act
    fireEvent.click(toggle());

    // Assert
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(content().closest('[hidden]')).not.toBeNull();
  });

  it('should show its content again when the arrow is clicked twice', () => {
    // Arrange
    renderPanel();

    // Act
    fireEvent.click(toggle());
    fireEvent.click(toggle());

    // Assert
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(content().closest('[hidden]')).toBeNull();
  });

  it('should keep its content in the page while folded, so that what the user typed is not lost', () => {
    // Arrange
    render(
      <FoldablePanel id="panel" title="Réglages">
        <input aria-label="Champ" />
      </FoldablePanel>,
    );
    fireEvent.change(screen.getByLabelText('Champ'), { target: { value: 'abc' } });

    // Act
    fireEvent.click(toggle());
    fireEvent.click(toggle());

    // Assert
    expect((screen.getByLabelText<HTMLInputElement>('Champ')).value).toBe('abc');
  });

  it('should keep the title as a heading, so that the page outline is the same', () => {
    // Arrange / Act
    renderPanel();

    // Assert
    expect(screen.getByRole('heading', { level: 2, name: 'Réglages' })).toBeTruthy();
  });

  it('should link the button to the content it controls', () => {
    // Arrange / Act
    renderPanel();

    // Assert
    expect(toggle().getAttribute('aria-controls')).toBe(content().parentElement?.id);
  });

  it('should be a level 3 heading, without the look of a page panel, when it sits inside another panel', () => {
    // Arrange / Act
    render(
      <FoldablePanel id="panel" title="Réglages" nested>
        <p>Contenu du bloc</p>
      </FoldablePanel>,
    );

    // Assert
    expect(screen.getByRole('heading', { level: 3, name: 'Réglages' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Réglages' })).not.toHaveClass('panel');
  });

  it('should be a level 2 heading with the look of a panel when it stands alone', () => {
    // Arrange / Act
    renderPanel();

    // Assert
    expect(screen.getByRole('heading', { level: 2, name: 'Réglages' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Réglages' })).toHaveClass('panel');
  });
});
