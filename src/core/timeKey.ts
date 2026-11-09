// The shapes of timestamp the built-in profiles can give: a date and a time, or a time of day. The fraction of
// second is kept so that two errors in the same second still sort. The offset (`+01:00`) is not read.
const DATE_AND_TIME = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/;
const TIME_OF_DAY = /(\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/;

/** A string that sorts like time, or `null` when the timestamp is missing or cannot be placed. */
export function timeKey(timestamp: string | null): string | null {
  if (timestamp === null) {
    return null;
  }
  const dated = DATE_AND_TIME.exec(timestamp);
  const key = dated === null ? TIME_OF_DAY.exec(timestamp)?.[1] : `${dated[1] ?? ''}T${dated[2] ?? ''}`;
  return key === undefined ? null : key.replace(',', '.');
}
