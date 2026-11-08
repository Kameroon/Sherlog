/**
 * Cuts a string to `limit` UTF-16 units without leaving half of a surrogate pair at the end, which would show
 * as a broken character (an emoji is two units).
 */
export function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const last = text.charCodeAt(limit - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, splitsPair ? limit - 1 : limit);
}
