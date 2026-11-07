/** Formats a count the French way (`120 000`); the separator is a narrow no-break space. */
export function formatCount(count: number): string {
  return count.toLocaleString('fr-FR');
}

/** `1 erreur`, `2 erreurs`: French writes the singular for 0 and 1. */
export function countOf(count: number, singular: string, plural: string): string {
  return `${formatCount(count)} ${count > 1 ? plural : singular}`;
}
