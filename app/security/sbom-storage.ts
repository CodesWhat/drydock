import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SBOM_FORMATS = ['spdx-json', 'cyclonedx-json'] as const;
const DEFAULT_MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/i;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const SBOM_KEY_PATTERN =
  /^sbom\/([0-9a-f]{64})(?:\/([0-9a-f]{64}))?\/(spdx-json|cyclonedx-json)\.json$/;

export type SbomFormat = (typeof SBOM_FORMATS)[number];

export type SbomDocumentRef = {
  key: string;
  sha256: string;
  bytes: number;
};

export interface WriteSbomDocumentOptions {
  subjectDigest?: string;
  image: string;
  format: SbomFormat;
  document: unknown;
}

export interface CreateSbomStorageOptions {
  rootDir: string;
  maxDocumentBytes?: number;
}

export interface SbomStorage {
  writeDocument(options: WriteSbomDocumentOptions): Promise<SbomDocumentRef>;
  readDocument(ref: SbomDocumentRef, format: SbomFormat): Promise<unknown>;
}

function isSbomFormat(value: unknown): value is SbomFormat {
  return typeof value === 'string' && SBOM_FORMATS.includes(value as SbomFormat);
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortJsonValue(record[key])]),
    );
  }
  return value;
}

function serializeCanonicalJson(document: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(document);
  } catch {
    throw new Error('Invalid SBOM JSON document');
  }
  if (serialized === undefined) {
    throw new Error('Invalid SBOM JSON document');
  }

  try {
    return JSON.stringify(sortJsonValue(JSON.parse(serialized)));
  } catch {
    /* v8 ignore next -- JSON.stringify above guarantees syntactically valid JSON. */
    throw new Error('Invalid SBOM JSON document');
  }
}

function getSubjectDirectory(options: {
  subjectDigest?: string;
  image: string;
  documentJson: string;
}): string {
  if (
    typeof options.subjectDigest === 'string' &&
    SHA256_DIGEST_PATTERN.test(options.subjectDigest)
  ) {
    return hash(options.subjectDigest.toLowerCase());
  }
  return hash(`${options.image}\0${options.documentJson}`);
}

function getPathKindError(targetPath: string): Error | undefined {
  try {
    const stats = fs.lstatSync(targetPath);
    if (stats.isSymbolicLink()) {
      return new Error('SBOM storage path must not be a symbolic link');
    }
    if (!stats.isDirectory()) {
      return new Error('SBOM storage parent must be a directory');
    }
    return undefined;
  } catch (error: unknown) {
    /* v8 ignore next 3 -- Only ENOENT is practically produced by this lstat. */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    /* v8 ignore next -- Defensive propagation for unexpected filesystem failures. */
    throw error;
  }
}

async function ensurePrivateDirectory(targetPath: string, recursive = false): Promise<void> {
  const existingError = getPathKindError(targetPath);
  if (existingError) {
    throw existingError;
  }

  try {
    await fs.promises.mkdir(targetPath, { mode: 0o700, recursive });
  } catch (error: unknown) {
    /* v8 ignore next 3 -- Permission/device failures are platform-dependent and propagated. */
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  const stats = await fs.promises.lstat(targetPath);
  /* v8 ignore next 3 -- A hostile post-mkdir symlink swap is checked defensively. */
  if (stats.isSymbolicLink()) {
    throw new Error('SBOM storage path must not be a symbolic link');
  }
  /* v8 ignore next 3 -- A hostile post-mkdir file swap is checked defensively. */
  if (!stats.isDirectory()) {
    throw new Error('SBOM storage parent must be a directory');
  }
  await fs.promises.chmod(targetPath, 0o700);
}

async function assertMissingPathHasSafeAncestor(targetPath: string): Promise<void> {
  let currentPath = targetPath;
  while (true) {
    try {
      const stats = await fs.promises.lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error('SBOM storage path must not be a symbolic link');
      }
      return;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const parentPath = path.dirname(currentPath);
    /* v8 ignore next 3 -- The filesystem root always exists; this is defensive termination. */
    if (parentPath === currentPath) {
      return;
    }
    currentPath = parentPath;
  }
}

async function assertExistingDirectory(targetPath: string): Promise<void> {
  let stats: fs.Stats;
  try {
    stats = await fs.promises.lstat(targetPath);
  } catch (error: unknown) {
    /* v8 ignore next 3 -- Only ENOENT is practically produced by this lstat. */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('SBOM document not found');
    }
    /* v8 ignore next -- Defensive propagation for unexpected filesystem failures. */
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new Error('SBOM storage path must not be a symbolic link');
  }
  if (!stats.isDirectory()) {
    throw new Error('SBOM storage parent must be a directory');
  }
}

async function assertWritableTarget(targetPath: string): Promise<void> {
  try {
    const stats = await fs.promises.lstat(targetPath);
    if (stats.isSymbolicLink()) {
      throw new Error('SBOM storage path must not be a symbolic link');
    }
    if (!stats.isFile()) {
      throw new Error('SBOM document must be a regular file');
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function validateDocumentRef(
  ref: SbomDocumentRef,
  format: SbomFormat,
  maxDocumentBytes: number,
): RegExpMatchArray {
  if (!ref || typeof ref !== 'object' || !isSbomFormat(format)) {
    throw new Error('Invalid SBOM document ref');
  }
  const keyMatch = typeof ref.key === 'string' ? ref.key.match(SBOM_KEY_PATTERN) : null;
  if (
    !keyMatch ||
    keyMatch[3] !== format ||
    typeof ref.sha256 !== 'string' ||
    !SHA256_HEX_PATTERN.test(ref.sha256) ||
    !Number.isSafeInteger(ref.bytes) ||
    ref.bytes < 0 ||
    ref.bytes > maxDocumentBytes
  ) {
    throw new Error('Invalid SBOM document ref');
  }
  return keyMatch;
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(directory, fs.constants.O_RDONLY);
    await handle.sync();
  } catch {
    // Directory fsync is not supported on every platform. The file itself is
    // still synced before its atomic rename.
  } finally {
    /* v8 ignore next -- FileHandle.close rejection is non-actionable cleanup failure. */
    await handle?.close().catch(() => undefined);
  }
}

function resolveDocumentPath(rootDir: string, key: string): string {
  const resolved = path.resolve(rootDir, key);
  const rootPrefix = `${rootDir}${path.sep}`;
  /* v8 ignore next 3 -- Strict ref-key validation already excludes escaping keys. */
  if (!resolved.startsWith(rootPrefix)) {
    throw new Error('Invalid SBOM document ref');
  }
  return resolved;
}

export function createSbomStorage(options: CreateSbomStorageOptions): SbomStorage {
  const rootDir = path.resolve(options.rootDir);
  const maxDocumentBytes = options.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
  if (!Number.isSafeInteger(maxDocumentBytes) || maxDocumentBytes <= 0) {
    throw new Error('maxDocumentBytes must be a positive integer');
  }

  const writeLocks = new Map<string, Promise<void>>();

  async function getExistingDocumentRef(
    targetPath: string,
    key: string,
  ): Promise<SbomDocumentRef | undefined> {
    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stats = await handle.stat();
      /* v8 ignore next 3 -- The target was validated before open; only a hostile swap reaches this. */
      if (!stats.isFile()) {
        throw new Error('SBOM document must be a regular file');
      }
      if (stats.size > maxDocumentBytes) return undefined;
      const buffer = await handle.readFile();
      try {
        JSON.parse(buffer.toString('utf8'));
      } catch {
        return undefined;
      }
      return { key, sha256: hash(buffer), bytes: buffer.byteLength };
    } catch (error: unknown) {
      /* v8 ignore next 4 -- Non-ENOENT open failures are platform-dependent and propagated. */
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      /* v8 ignore next -- Non-ENOENT open failures are platform-dependent and propagated. */
      throw error;
    } finally {
      /* v8 ignore next -- FileHandle.close rejection is non-actionable cleanup failure. */
      await handle?.close().catch(() => undefined);
    }
  }

  async function withWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = writeLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    writeLocks.set(key, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (writeLocks.get(key) === current) {
        writeLocks.delete(key);
      }
    }
  }

  async function writeDocument(writeOptions: WriteSbomDocumentOptions): Promise<SbomDocumentRef> {
    if (!isSbomFormat(writeOptions.format)) {
      throw new Error('Unsupported SBOM format');
    }

    const documentJson = serializeCanonicalJson(writeOptions.document);
    const documentBuffer = Buffer.from(documentJson, 'utf8');
    if (documentBuffer.byteLength > maxDocumentBytes) {
      throw new Error(`SBOM document exceeds maximum size of ${maxDocumentBytes} bytes`);
    }

    const subjectDirectory = getSubjectDirectory({
      subjectDigest: writeOptions.subjectDigest,
      image: writeOptions.image,
      documentJson,
    });
    const documentHash = hash(documentBuffer);
    const key = `sbom/${subjectDirectory}/${documentHash}/${writeOptions.format}.json`;
    const ref: SbomDocumentRef = {
      key,
      sha256: documentHash,
      bytes: documentBuffer.byteLength,
    };

    return withWriteLock(key, async () => {
      await assertMissingPathHasSafeAncestor(rootDir);
      await ensurePrivateDirectory(rootDir, true);
      const sbomRoot = path.join(rootDir, 'sbom');
      await ensurePrivateDirectory(sbomRoot);
      const subjectPath = path.join(sbomRoot, subjectDirectory);
      await ensurePrivateDirectory(subjectPath);
      const documentDirectory = path.join(subjectPath, documentHash);
      await ensurePrivateDirectory(documentDirectory);

      const targetPath = resolveDocumentPath(rootDir, key);
      await assertWritableTarget(targetPath);
      const existingRef = await getExistingDocumentRef(targetPath, key);
      if (existingRef) {
        // Image-digest keys are immutable. Scanner metadata can make regenerated
        // SBOM JSON differ byte-for-byte; retaining the first valid blob keeps
        // every previously issued checksum-bearing reference readable.
        return existingRef;
      }

      const temporaryPath = path.join(
        documentDirectory,
        `.${writeOptions.format}.tmp-${process.pid}-${randomUUID()}`,
      );
      let handle: fs.promises.FileHandle | undefined;
      try {
        handle = await fs.promises.open(
          temporaryPath,
          fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_EXCL |
            fs.constants.O_NOFOLLOW,
          0o600,
        );
        await handle.writeFile(documentBuffer);
        await handle.sync();
        await handle.chmod(0o600);
        await handle.close();
        handle = undefined;

        // Re-check immediately before rename so an existing symlink is never
        // silently treated as an ordinary replaceable document.
        await assertWritableTarget(targetPath);
        await fs.promises.rename(temporaryPath, targetPath);
        await syncDirectory(documentDirectory);
        return ref;
      } finally {
        /* v8 ignore next 7 -- Cleanup failures require filesystem fault injection. */
        try {
          await handle?.close();
        } catch {
          // Best-effort cleanup; preserve the original write failure.
        }
        try {
          await fs.promises.rm(temporaryPath, { force: true });
        } catch {
          // Best-effort cleanup; preserve the original write failure.
        }
      }
    });
  }

  async function readDocument(ref: SbomDocumentRef, format: SbomFormat): Promise<unknown> {
    const keyMatch = validateDocumentRef(ref, format, maxDocumentBytes);
    await assertExistingDirectory(rootDir);
    const sbomRoot = path.join(rootDir, 'sbom');
    await assertExistingDirectory(sbomRoot);
    const targetPath = resolveDocumentPath(rootDir, ref.key);
    const subjectPath = path.join(sbomRoot, keyMatch[1]);
    await assertExistingDirectory(subjectPath);
    await assertExistingDirectory(path.dirname(targetPath));
    let targetStats: fs.Stats;
    try {
      targetStats = await fs.promises.lstat(targetPath);
    } catch (error: unknown) {
      /* v8 ignore next 3 -- Only ENOENT is practically produced by this lstat. */
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('SBOM document not found');
      }
      /* v8 ignore next -- Defensive propagation for unexpected filesystem failures. */
      throw error;
    }
    if (targetStats.isSymbolicLink()) {
      throw new Error('SBOM storage path must not be a symbolic link');
    }
    if (!targetStats.isFile()) {
      throw new Error('SBOM document must be a regular file');
    }

    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const openedStats = await handle.stat();
      /* v8 ignore next 3 -- A hostile post-open file-type swap is checked defensively. */
      if (!openedStats.isFile()) {
        throw new Error('SBOM document must be a regular file');
      }
      if (openedStats.size !== ref.bytes) {
        throw new Error('SBOM document size mismatch');
      }
      const documentBuffer = await handle.readFile();
      /* v8 ignore next 3 -- A concurrent post-stat truncation is checked defensively. */
      if (documentBuffer.byteLength !== ref.bytes) {
        throw new Error('SBOM document size mismatch');
      }
      if (hash(documentBuffer) !== ref.sha256) {
        throw new Error('SBOM document checksum mismatch');
      }

      try {
        return JSON.parse(documentBuffer.toString('utf8'));
      } catch {
        throw new Error('Invalid SBOM JSON document');
      }
    } catch (error: unknown) {
      /* v8 ignore next 3 -- lstat rejects symlinks first; O_NOFOLLOW closes the race. */
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('SBOM storage path must not be a symbolic link');
      }
      throw error;
    } finally {
      /* v8 ignore next -- FileHandle.close rejection is non-actionable cleanup failure. */
      await handle?.close().catch(() => undefined);
    }
  }

  return { writeDocument, readDocument };
}
