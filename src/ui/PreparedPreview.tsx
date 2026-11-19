import { MAX_PREVIEW_LINES } from '../core/previewHead';
import type { HeadPreview } from '../core/previewHead';
import { FoldablePanel } from './FoldablePanel';
import { formatCount, formatSize } from './format';

interface PreparedPreviewProps {
  preview: HeadPreview;
  /** Name of the log, for the caption. */
  name: string;
  /** Bytes read from the source for the preview. */
  headBytes: number;
  /** Size of the whole source. */
  sourceBytes: number;
  /** `true` when the preview covers the whole source. */
  complete: boolean;
  /** `true` to show the lines as they are in the log instead of masked. */
  showOriginal?: boolean;
}

function tagOf(line: HeadPreview['lines'][number]): string {
  if (line.kind === 'columns') {
    return 'colonnes';
  }
  if (line.kind === 'continuation') {
    return 'suite';
  }
  return line.ignored ? 'ignorée' : (line.level ?? '').toUpperCase();
}

/**
 * The first lines of the log as the preparation sees them: headers apart from the lines that continue them, errors
 * marked, and the lines of entries that are left out struck through. Text only: a log line is never markup.
 */
export function PreparedPreview({ preview, name, headBytes, sourceBytes, complete, showOriginal = false }: PreparedPreviewProps) {
  const where = complete
    ? `${formatCount(preview.totalLines)} lignes lues dans ce navigateur`
    : `début du fichier (${formatSize(headBytes)} sur ${formatSize(sourceBytes)}) : ${formatCount(preview.totalLines)} lignes`;
  const hidden = preview.totalLines - preview.lines.length;

  return (
    <FoldablePanel id="preview" title="Aperçu du journal préparé" className="prep-view">
      <p className="small-note">
        {name} · {where}.{hidden > 0 ? ` Aperçu des ${MAX_PREVIEW_LINES} premières.` : ''}
      </p>
      {/* The preview scrolls in its own box, so that the button that starts the analysis stays within reach: the box is a stop for the keyboard. */}
      <div className="excerpt-scroll" role="region" aria-label="Lignes de l’aperçu" tabIndex={0}>
        <ol className="excerpt" aria-label="Premières lignes du journal">
          {preview.lines.map((line) => {
            const classes = [line.kind === 'header' ? 'is-header' : 'is-continuation'];
            if (line.isError) {
              classes.push('is-error');
            }
            if (line.ignored) {
              classes.push('is-ignored');
            }
            return (
              <li key={line.number} className={classes.join(' ')}>
                <span className="line-no">{line.number}</span>
                <span className="line-tag">{tagOf(line)}</span>
                <span>
                  {showOriginal ? line.originalText : line.text}
                  {(showOriginal ? line.originalCut : line.cut) ? '…' : ''}
                  {line.ignored && <span className="visually-hidden"> (écartée)</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <ul className="legend">
        <li>Lignes barrées : écartées par vos réglages</li>
        <li>Lignes en rouge : erreurs gardées</li>
      </ul>
    </FoldablePanel>
  );
}
