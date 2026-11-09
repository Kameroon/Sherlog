/**
 * What is used of the File System Access API. The types are written here, not taken from a package: only a few members
 * are used, and `lib.dom` does not have the picker nor the permission methods. Only reading is described: no member
 * that writes or removes is declared, so that the code cannot use one (`tests/sourceGuards.test.ts` checks it too).
 */
export interface FolderEntry {
  readonly kind: string;
  readonly name: string;
  /** Only for a file. */
  readonly getFile?: () => Promise<File>;
}

export interface FolderHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<FolderEntry>;
  queryPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>;
}

export type DirectoryPicker = (options: { mode: 'read'; id: string }) => Promise<FolderHandle>;

/**
 * The most files listed from a folder. A folder is listed one level deep and read by the user's choice of a file, so
 * this is a bound on the list on screen and on the work of listing, not on what can be analysed.
 */
export const MAX_FOLDER_FILES = 1_000;

export interface FolderFile {
  readonly name: string;
  readonly size: number;
  /** Last modification, in milliseconds since 1970. */
  readonly modified: number;
  /** The file, to be read by the same pipeline as a file chosen by hand. */
  readonly file: File;
}

export interface FolderListing {
  readonly folderName: string;
  /** The files, the most recently modified first. */
  readonly files: readonly FolderFile[];
  /** `true` when the folder has more files than `MAX_FOLDER_FILES`: the others, in the order of the folder, are not listed. */
  readonly moreThanListed: boolean;
  /** Files that could not be read when listing (removed or locked meanwhile): counted, not hidden. */
  readonly unreadable: number;
}

/** The picker of a window, or `null` in a browser that has none (Firefox, Safari). */
export function directoryPickerOf(scope: object): DirectoryPicker | null {
  const picker = (scope as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  // Called as a method of the window it came from: apart from it the browser refuses ("Illegal invocation").
  return typeof picker === 'function' ? (options) => picker.call(scope, options) : null;
}

/** The identifier that makes the browser open the dialog where it was last, for this application. */
const PICKER_ID = 'sherlog-logs';

/**
 * Asks the user for a folder, to read only. Nothing in the application writes to the disk (`mode: 'read'`).
 *
 * @returns the folder, or `null` when the user closed the dialog.
 */
export async function pickFolder(picker: DirectoryPicker): Promise<FolderHandle | null> {
  try {
    return await picker({ mode: 'read', id: PICKER_ID });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return null;
    }
    throw error;
  }
}

/**
 * Lists the files of a folder, one level deep (a sub-folder is neither entered nor listed), up to `MAX_FOLDER_FILES`,
 * the most recently modified first. Nothing of a file is read: only its name, size and date. The files after the limit
 * are not even opened.
 *
 * @throws the error of the browser when the folder cannot be read, or an `AbortError` when `signal` is aborted.
 */
export async function listFolder(handle: FolderHandle, signal?: AbortSignal): Promise<FolderListing> {
  const files: FolderFile[] = [];
  let unreadable = 0;
  let moreThanListed = false;
  for await (const entry of handle.values()) {
    signal?.throwIfAborted();
    if (entry.kind !== 'file' || entry.getFile === undefined) {
      continue;
    }
    if (files.length + unreadable >= MAX_FOLDER_FILES) {
      moreThanListed = true;
      break;
    }
    try {
      const file = await entry.getFile();
      files.push({ name: entry.name, size: file.size, modified: file.lastModified, file });
    } catch {
      // A file removed or locked since the listing began: it is counted and said, the rest of the folder is still listed.
      unreadable += 1;
    }
  }
  files.sort((left, right) => right.modified - left.modified);
  return { folderName: handle.name, files, moreThanListed, unreadable };
}

/**
 * Whether the folder can be read now. A folder kept from an earlier visit is not readable until the user allows it
 * again: `ask` may only be `true` from a click, since the browser refuses to ask otherwise.
 */
export async function readPermission(handle: FolderHandle, ask: boolean): Promise<PermissionState> {
  // A handle without the methods (the origin-private folder) is always readable.
  const current = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
  if (current === 'prompt' && ask && handle.requestPermission !== undefined) {
    return handle.requestPermission({ mode: 'read' });
  }
  return current;
}
