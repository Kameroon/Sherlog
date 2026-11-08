/** Formats a count the French way (`120 000`); the separator is a narrow no-break space. */
export function formatCount(count: number): string {
  return count.toLocaleString('fr-FR');
}

/** A size in bytes the way the rest of the screen counts: `3 Mio`, `512 Kio`. */
export function formatSize(bytes: number): string {
  const mebi = 1024 * 1024;
  if (bytes >= mebi) {
    return `${(bytes / mebi).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mio`;
  }
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('fr-FR')} Kio`;
}

/** `1 erreur`, `2 erreurs`: French writes the singular for 0 and 1. */
export function countOf(count: number, singular: string, plural: string): string {
  return `${formatCount(count)} ${count > 1 ? plural : singular}`;
}
