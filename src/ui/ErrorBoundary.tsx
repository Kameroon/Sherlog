import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * `page` (default) wraps the whole page: its fallback is the page title. `panel` wraps one part of the screen, so
   * that a failure there leaves the rest in place: its fallback is short and says so.
   */
  scope?: 'page' | 'panel';
}

interface ErrorBoundaryState {
  hasFailed: boolean;
}

/**
 * Catches rendering crashes so one broken component never leaves a blank screen.
 *
 * It deliberately neither logs nor displays the error: the message may quote analysed log
 * content or a key, and nothing may leave the browser or reach the console (see ADR-008).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasFailed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasFailed: true };
  }

  private readonly retry = (): void => {
    this.setState({ hasFailed: false });
  };

  override render(): ReactNode {
    if (!this.state.hasFailed) {
      return this.props.children;
    }
    if (this.props.scope === 'panel') {
      return (
        <div role="alert" className="error-fallback error-fallback-panel">
          <h2>Ce panneau n’a pas pu s’afficher</h2>
          <p>Le reste de l’écran fonctionne. Aucune donnée n’a quitté votre navigateur.</p>
          <button type="button" onClick={this.retry}>
            Réessayer
          </button>
        </div>
      );
    }
    return (
      <div role="alert" className="error-fallback">
        {/* h1: the boundary wraps the whole page, so in this state the fallback is the page title. */}
        <h1>Une erreur est survenue</h1>
        <p>L’affichage a rencontré un problème. Aucune donnée n’a quitté votre navigateur.</p>
        <button type="button" onClick={this.retry}>
          Réessayer
        </button>
      </div>
    );
  }
}
