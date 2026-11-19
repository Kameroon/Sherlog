// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createEntryAssembler } from '../src/core/entryAssembler';
import type { EntryAssemblerOptions, LogEntry } from '../src/core/entryAssembler';
import { createLineSplitter } from '../src/core/lineSplitter';
import type { LineSplitterOptions } from '../src/core/lineSplitter';
import { LOG_ANALYTICS_CSV_PROFILE } from '../src/core/profiles';

function assemble(text: string, options?: EntryAssemblerOptions, splitterOptions?: LineSplitterOptions): LogEntry[] {
  const splitter = createLineSplitter(splitterOptions);
  const assembler = createEntryAssembler(LOG_ANALYTICS_CSV_PROFILE, options);
  const lines = [...splitter.push(new TextEncoder().encode(text)), ...splitter.finish()];
  const entries = lines.flatMap((line) => assembler.push(line) ?? []);
  const last = assembler.finish();
  return last === null ? entries : [...entries, last];
}

const names = 'TenantId,"TimeGenerated [UTC]",Message,SeverityLevel,Type';

function row(time: string, message: string, level: string): string {
  return `"tenant","${time}","${message}",${level},AppTraces`;
}

describe('createEntryAssembler with the Log Analytics CSV export', () => {
  it('should read the timestamp, level and message of each row when the first line names the columns', () => {
    // Arrange
    const text = [names, row('20/10/2026 00:41:49.839', 'Started', '1'), row('21/10/2026 08:16:10.332', 'Timeout', '3')].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries.map((entry) => [entry.timestamp, entry.level, entry.message])).toEqual([
      ['2026-10-20T00:41:49.839Z', 'Information', 'Started'],
      ['2026-10-21T08:16:10.332Z', 'Error', 'Timeout'],
    ]);
  });

  it('should find the fields by the name of their column when the columns are in another order', () => {
    // Arrange
    const text = ['SeverityLevel,Message,"TimeGenerated [UTC]"', '4,"Disk full","20/10/2026 00:41:49.839"'].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries.map((entry) => [entry.timestamp, entry.level, entry.message])).toEqual([['2026-10-20T00:41:49.839Z', 'Critical', 'Disk full']]);
  });

  it('should not make an entry of the line of column names', () => {
    // Arrange
    const text = `${names}\r\n${row('20/10/2026 00:41:49.839', 'Started', '1')}`;

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries.map((entry) => entry.offset)).toEqual([new TextEncoder().encode(`${names}\r\n`).length]);
  });

  it('should keep a quoted message that spans several lines in one entry when the line breaks are inside the quotes', () => {
    // Arrange
    const text = [names, row('20/10/2026 00:41:49.839', 'Import failed\n   at Shop.Import.Run()', '3'), row('20/10/2026 00:41:50.000', 'Next', '1')].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries.map((entry) => [entry.level, entry.lineCount, entry.text])).toEqual([
      ['Error', 2, '"tenant","20/10/2026 00:41:49.839","Import failed\n   at Shop.Import.Run()",3,AppTraces'],
      ['Information', 1, '"tenant","20/10/2026 00:41:50.000","Next",1,AppTraces'],
    ]);
  });

  it('should keep only the first line of a message that spans several lines as the message', () => {
    // Arrange
    const text = [names, row('20/10/2026 00:41:49.839', 'Import failed\nsecond line', '3')].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries[0]?.message).toBe('Import failed');
  });

  it('should read a doubled quote as one quote and a comma inside quotes as text when the message holds them', () => {
    // Arrange
    const text = [names, row('20/10/2026 00:41:49.839', 'File ""a.csv"", row 12', '3')].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries[0]?.message).toBe('File "a.csv", row 12');
  });

  it('should read a quote inside an unquoted field as text when it does not open the field', () => {
    // Arrange: a quote that opened a field there would swallow the next row into this one
    const text = [names, '"tenant","20/10/2026 00:41:49.839",5"inches,3,AppTraces', row('20/10/2026 00:41:50.000', 'Next', '4')].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries.map((entry) => [entry.message, entry.level])).toEqual([
      ['5"inches', 'Error'],
      ['Next', 'Critical'],
    ]);
  });

  it('should keep a level that is not in the table as written', () => {
    // Arrange
    const text = [names, row('20/10/2026 00:41:49.839', 'Odd', '7')].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries[0]?.level).toBe('7');
  });

  it('should keep a level named like an object property as written when it is not in the table', () => {
    // Arrange
    const text = [names, row('20/10/2026 00:41:49.839', 'Odd', 'constructor')].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries[0]?.level).toBe('constructor');
  });

  it('should give no level when the row stops before the level column', () => {
    // Arrange
    const text = [names, '"tenant","20/10/2026 00:41:49.839","Short row"'].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries[0]?.level).toBeNull();
  });

  it.each([
    ['a month above 12, which shows that the day is not first', '10/20/2026 00:41:49.839'],
    ['an ISO date', '2026-10-20 00:41:49.839'],
    ['a 12-hour clock', '20/10/2026 12:41:49.839 AM'],
    ['an hour above 23', '20/10/2026 24:41:49.839'],
    ['a day 00', '00/10/2026 00:41:49.839'],
    ['text before it', 'on 20/10/2026 00:41:49.839'],
  ])('should give no timestamp when the date has %s', (_, time) => {
    // Arrange
    const text = [names, row(time, 'Started', '1')].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries[0]?.timestamp).toBeNull();
  });

  it('should read the date when it has no fraction of a second', () => {
    // Arrange
    const text = [names, row('31/12/2026 23:59:59', 'Started', '1')].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries[0]?.timestamp).toBe('2026-12-31T23:59:59Z');
  });

  it.each([
    ['the time', 'TenantId,Message,SeverityLevel'],
    ['the level', 'TenantId,"TimeGenerated [UTC]",Message'],
    ['the message', 'TenantId,"TimeGenerated [UTC]",SeverityLevel'],
  ])('should read the whole text as one entry without a level when the column of %s is missing', (_, columnNames) => {
    // Arrange
    const text = [columnNames, '"tenant","20/10/2026 00:41:49.839",3', '"tenant","20/10/2026 00:41:50.000",3'].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries.map((entry) => [entry.offset, entry.level, entry.lineCount])).toEqual([[0, null, 3]]);
  });

  it('should give what was read of a record that the end of the input leaves open, without its later fields', () => {
    // Arrange: the beginning of a big file can stop inside a quoted message
    const text = [names, '"tenant","20/10/2026 00:41:49.839","Import failed', 'still the message'].join('\r\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries.map((entry) => [entry.timestamp, entry.level, entry.lineCount])).toEqual([['2026-10-20T00:41:49.839Z', null, 2]]);
  });

  it('should cover the input without gaps from the first row to the end when rows follow each other', () => {
    // Arrange
    const text = [names, row('20/10/2026 00:41:49.839', 'a\nb', '3'), row('20/10/2026 00:41:50.000', 'c', '1')].join('\r\n') + '\r\n';
    const totalBytes = new TextEncoder().encode(text).length;

    // Act
    const entries = assemble(text);

    // Assert
    const gaps = entries.map((entry, index) => entry.offset + entry.length - (entries[index + 1]?.offset ?? totalBytes));
    expect(gaps).toEqual([0, 0]);
  });

  it('should still read the level of a row whose retained text is cut by the limit', () => {
    // Arrange: the level column comes after a message longer than what is retained
    const text = [names, row('20/10/2026 00:41:49.839', `Failed\n${'x'.repeat(200)}`, '3')].join('\r\n');

    // Act
    const entries = assemble(text, { maxRetainedBytes: 100 });

    // Assert
    expect(entries.map((entry) => [entry.level, entry.truncated])).toEqual([['Error', true]]);
  });

  it('should refuse to read on when a line was cut by the line splitter, since its quotes can no longer be counted', () => {
    // Arrange
    const text = [names, row('20/10/2026 00:41:49.839', 'x'.repeat(200), '3')].join('\r\n');

    // Act
    const reading = () => assemble(text, {}, { maxRetainedBytes: 100 });

    // Assert
    expect(reading).toThrow('trop longue');
  });
});
