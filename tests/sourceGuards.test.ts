// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceDirectory = resolve(import.meta.dirname, '../src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const sources = sourceFiles(sourceDirectory).map((path) => ({ file: relative(sourceDirectory, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }));

/** The files of `src` that contain a match for the pattern. */
const filesWith = (pattern: RegExp): string[] => sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file);

// These guard what the security audit of step 7 established (ADR-017): the facts below must not change by accident.
describe('source guards', () => {
  it('should send requests only from the one module that sets the headers, the credentials and the referrer', () => {
    // Act
    const callers = filesWith(/\bfetchImpl\(|(?<![.\w])fetch\(/);

    // Assert
    expect(callers).toEqual(['ai/request.ts', 'auth/clientPrincipal.ts']);
  });

  it.each(['XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'importScripts'])('should not use %s, another way out of the browser', (api) => {
    // Act & Assert
    expect(filesWith(new RegExp(`\\b${api}\\b`))).toEqual([]);
  });

  it('should never write to the console, where a key or a log could end up', () => {
    // Act & Assert
    expect(filesWith(/\bconsole\.(log|info|warn|error|debug|trace|dir|table|assert)\b/)).toEqual([]);
  });

  it('should keep the storage of the tab and of the computer in the one module that scopes it by identity', () => {
    // Act & Assert
    expect(filesWith(/\b(sessionStorage|localStorage)\b/)).toEqual(['store/aiSettings.ts']);
  });

  it('should keep IndexedDB, where the folder kept is, in the one module that scopes it by identity', () => {
    // Act & Assert
    expect(filesWith(/\bindexedDB\b/)).toEqual(['store/folderStore.ts']);
  });

  it('should reach the folder picker of the browser from the one module that asks for read mode', () => {
    // Act & Assert
    expect(filesWith(/\bshowDirectoryPicker\b/)).toEqual(['sources/folder.ts']);
  });

  // Nothing in the application writes to the user's disk (ADR-020, A1): not one call that creates, writes or removes.
  it.each(['createWritable', 'removeEntry', 'getFileHandle', 'getDirectoryHandle', 'showSaveFilePicker', 'showOpenFilePicker', 'FileSystemWritableFileStream'])(
    'should never use %s, which writes to or opens files on the disk',
    (api) => {
      // Act & Assert
      expect(sources.filter(({ text }) => text.includes(api)).map(({ file }) => file)).toEqual([]);
    },
  );

  it('should never ask the browser for a folder in write mode', () => {
    // Act & Assert
    expect(filesWith(/mode:\s*['"]readwrite['"]/)).toEqual([]);
  });

  it.each(['dangerouslySetInnerHTML', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function'])('should not use %s', (api) => {
    // Act & Assert
    expect(sources.filter(({ text }) => text.includes(api)).map(({ file }) => file)).toEqual([]);
  });

  it('should hold no style attribute or style element, which the CSP refuses', () => {
    // Act & Assert
    expect(filesWith(/style=\{|<style/)).toEqual([]);
  });

  it('should hold no key of a provider written in the code', () => {
    // Act & Assert
    expect(filesWith(/sk-ant-[A-Za-z0-9_-]{6,}/)).toEqual([]);
  });
});
