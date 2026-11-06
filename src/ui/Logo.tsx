/** Brand mark and name. The mark is decorative: the text next to it carries the name. */
export function Logo() {
  return (
    <span className="logo">
      <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <circle cx="14" cy="14" r="8" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M20 20l7 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M10 12h8M10 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      Sherlog
    </span>
  );
}
