import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSbomStorage, type SbomDocumentRef } from './sbom-storage.js';

const VALID_DIGEST = `sha256:${'AB'.repeat(32)}`;
const FORMAT = 'spdx-json' as const;

function createRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-sbom-storage-'));
}

function digestDirectory(digest: string): string {
  return createHash('sha256').update(digest.toLowerCase()).digest('hex');
}

function contentAddressedPath(rootDir: string, document: unknown): string {
  const documentHash = createHash('sha256').update(JSON.stringify(document)).digest('hex');
  return path.join(rootDir, 'sbom', digestDirectory(VALID_DIGEST), documentHash, `${FORMAT}.json`);
}

function tempFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  return fs
    .readdirSync(rootDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.includes('.tmp-'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe('SBOM storage', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = createRoot();
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  test('writes a digest-addressed document with private permissions and reads it back', async () => {
    const storage = createSbomStorage({ rootDir });
    const document = { SPDXID: 'SPDXRef-DOCUMENT', packages: [{ name: 'busybox' }] };

    const ref = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document,
    });

    const expectedDirectory = digestDirectory(VALID_DIGEST);
    const documentHash = createHash('sha256').update(JSON.stringify(document)).digest('hex');
    expect(ref).toEqual({
      key: `sbom/${expectedDirectory}/${documentHash}/spdx-json.json`,
      sha256: documentHash,
      bytes: Buffer.byteLength(JSON.stringify(document)),
    });
    expect(await storage.readDocument(ref, FORMAT)).toEqual(document);

    const sbomDirectory = path.join(rootDir, 'sbom');
    const digestPath = path.join(sbomDirectory, expectedDirectory);
    const documentPath = path.join(rootDir, ref.key);
    expect(fs.statSync(sbomDirectory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(digestPath).mode & 0o777).toBe(0o700);
    expect(fs.statSync(documentPath).mode & 0o777).toBe(0o600);
  });

  test('canonicalizes a valid sha256 digest before deriving its directory', async () => {
    const storage = createSbomStorage({ rootDir });

    const upper = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:one',
      format: FORMAT,
      document: { value: 1 },
    });
    const lower = await storage.writeDocument({
      subjectDigest: VALID_DIGEST.toLowerCase(),
      image: 'registry.example/app:two',
      format: FORMAT,
      document: { value: 1 },
    });

    expect(upper.key).toBe(lower.key);
  });

  test('reads legacy digest-and-format references created before content-addressed keys', async () => {
    const storage = createSbomStorage({ rootDir });
    const document = { SPDXID: 'SPDXRef-LEGACY' };
    const currentRef = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document,
    });
    const legacyRef = {
      ...currentRef,
      key: `sbom/${digestDirectory(VALID_DIGEST)}/spdx-json.json`,
    };
    fs.renameSync(path.join(rootDir, currentRef.key), path.join(rootDir, legacyRef.key));

    await expect(storage.readDocument(legacyRef, FORMAT)).resolves.toEqual(document);
  });

  test('uses canonical document content and image for deterministic fallback addressing', async () => {
    const storage = createSbomStorage({ rootDir });
    const firstDocument = { z: 1, nested: { b: 2, a: 1 } };
    const secondDocument = { nested: { a: 1, b: 2 }, z: 1 };

    const missingDigest = await storage.writeDocument({
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: firstDocument,
    });
    const invalidDigest = await storage.writeDocument({
      subjectDigest: 'not-a-digest',
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: secondDocument,
    });

    expect(missingDigest.key).toBe(invalidDigest.key);
    expect(await storage.readDocument(invalidDigest, FORMAT)).toEqual(secondDocument);
  });

  test('separates fallback documents for different images or content', async () => {
    const storage = createSbomStorage({ rootDir });

    const base = await storage.writeDocument({
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: { value: 1 },
    });
    const otherImage = await storage.writeDocument({
      image: 'registry.example/other:latest',
      format: FORMAT,
      document: { value: 1 },
    });
    const otherContent = await storage.writeDocument({
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: { value: 2 },
    });

    expect(otherImage.key).not.toBe(base.key);
    expect(otherContent.key).not.toBe(base.key);
  });

  test.each([
    ['undefined', undefined],
    ['symbol', Symbol('sbom')],
    ['bigint', 1n],
    ['circular object', { self: null }],
  ])('rejects non-JSON document %s', async (_label, document) => {
    if (document && typeof document === 'object') {
      (document as { self: unknown }).self = document;
    }
    const storage = createSbomStorage({ rootDir });

    await expect(
      storage.writeDocument({
        image: 'registry.example/app:latest',
        format: FORMAT,
        document,
      }),
    ).rejects.toThrow('Invalid SBOM JSON document');
  });

  test.each([
    '../spdx-json',
    'SPDX-JSON',
    'json',
    '',
    'spdx-json\\escape',
    'spdx-json\0',
  ])('rejects unsupported write format %j', async (format) => {
    const storage = createSbomStorage({ rootDir });

    await expect(
      storage.writeDocument({
        subjectDigest: VALID_DIGEST,
        image: 'registry.example/app:latest',
        format: format as never,
        document: {},
      }),
    ).rejects.toThrow('Unsupported SBOM format');
  });

  test.each([
    '/tmp/document.json',
    '../sbom/escape/spdx-json.json',
    'sbom/../escape/spdx-json.json',
    'sbom\\hash\\spdx-json.json',
    'sbom/hash/spdx-json.json\0escape',
    'sbom/not-a-hash/spdx-json.json',
    `sbom/${'a'.repeat(64)}/cyclonedx-json.json`,
  ])('rejects unsafe or mismatched stored key %j', async (key) => {
    const storage = createSbomStorage({ rootDir });
    const ref: SbomDocumentRef = { key, sha256: 'a'.repeat(64), bytes: 2 };

    await expect(storage.readDocument(ref, FORMAT)).rejects.toThrow('Invalid SBOM document ref');
  });

  test('rejects invalid checksum and byte metadata before reading', async () => {
    const storage = createSbomStorage({ rootDir });
    const ref = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: { ok: true },
    });

    await expect(
      storage.readDocument({ ...ref, sha256: 'not-a-checksum' }, FORMAT),
    ).rejects.toThrow('Invalid SBOM document ref');
    await expect(storage.readDocument({ ...ref, bytes: -1 }, FORMAT)).rejects.toThrow(
      'Invalid SBOM document ref',
    );
    await expect(storage.readDocument({ ...ref, bytes: 1.5 }, FORMAT)).rejects.toThrow(
      'Invalid SBOM document ref',
    );
    await expect(
      storage.readDocument({ ...ref, bytes: Number.MAX_SAFE_INTEGER }, FORMAT),
    ).rejects.toThrow('Invalid SBOM document ref');
    await expect(storage.readDocument(ref, 'invalid' as never)).rejects.toThrow(
      'Invalid SBOM document ref',
    );
    await expect(storage.readDocument(null as never, FORMAT)).rejects.toThrow(
      'Invalid SBOM document ref',
    );
    await expect(storage.readDocument({ ...ref, key: 42 as never }, FORMAT)).rejects.toThrow(
      'Invalid SBOM document ref',
    );
  });

  test.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid maxDocumentBytes %j', (maxDocumentBytes) => {
    expect(() => createSbomStorage({ rootDir, maxDocumentBytes })).toThrow(
      'maxDocumentBytes must be a positive integer',
    );
  });

  test('rejects oversized writes without replacing the existing valid document', async () => {
    const storage = createSbomStorage({ rootDir, maxDocumentBytes: 32 });
    const original = { value: 'kept' };
    const ref = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: original,
    });

    await expect(
      storage.writeDocument({
        subjectDigest: VALID_DIGEST,
        image: 'registry.example/app:latest',
        format: FORMAT,
        document: { value: 'x'.repeat(100) },
      }),
    ).rejects.toThrow('SBOM document exceeds');

    expect(await storage.readDocument(ref, FORMAT)).toEqual(original);
    expect(tempFiles(rootDir)).toEqual([]);
  });

  test('rejects a read when persisted bytes do not match the reference', async () => {
    const storage = createSbomStorage({ rootDir });
    const ref = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: { ok: true },
    });

    await expect(storage.readDocument({ ...ref, bytes: ref.bytes + 1 }, FORMAT)).rejects.toThrow(
      'SBOM document size mismatch',
    );
  });

  test('rejects a read when persisted content does not match the checksum', async () => {
    const storage = createSbomStorage({ rootDir });
    const ref = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: { ok: true },
    });
    const replacement = JSON.stringify({ no: false });
    fs.writeFileSync(path.join(rootDir, ref.key), replacement, { mode: 0o600 });

    await expect(
      storage.readDocument({ ...ref, bytes: Buffer.byteLength(replacement) }, FORMAT),
    ).rejects.toThrow('SBOM document checksum mismatch');
  });

  test('rejects invalid JSON even when size and checksum metadata match', async () => {
    const storage = createSbomStorage({ rootDir });
    const ref = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: { ok: true },
    });
    const invalidJson = '{';
    fs.writeFileSync(path.join(rootDir, ref.key), invalidJson, { mode: 0o600 });

    await expect(
      storage.readDocument(
        {
          ...ref,
          bytes: Buffer.byteLength(invalidJson),
          sha256: createHash('sha256').update(invalidJson).digest('hex'),
        },
        FORMAT,
      ),
    ).rejects.toThrow('Invalid SBOM JSON document');
  });

  test('repairs a corrupt digest-addressed blob during regeneration', async () => {
    const storage = createSbomStorage({ rootDir });
    const first = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: { generated: 'first' },
    });
    fs.writeFileSync(path.join(rootDir, first.key), '{', { mode: 0o600 });

    const repaired = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: { generated: 'repaired' },
    });

    await expect(storage.readDocument(repaired, FORMAT)).resolves.toEqual({
      generated: 'repaired',
    });
  });

  test('replaces invalid JSON found at the requested content-addressed path', async () => {
    const document = { generated: 'expected' };
    const targetPath = contentAddressedPath(rootDir, document);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(targetPath, '{', { mode: 0o600 });
    const storage = createSbomStorage({ rootDir });

    const repaired = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document,
    });

    await expect(storage.readDocument(repaired, FORMAT)).resolves.toEqual(document);
    expect(tempFiles(rootDir)).toEqual([]);
  });

  test('replaces an oversized blob found at the requested content-addressed path', async () => {
    const document = { ok: true };
    const targetPath = contentAddressedPath(rootDir, document);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(targetPath, 'x'.repeat(64), { mode: 0o600 });
    const storage = createSbomStorage({ rootDir, maxDocumentBytes: 32 });

    const repaired = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document,
    });

    await expect(storage.readDocument(repaired, FORMAT)).resolves.toEqual(document);
    expect(fs.statSync(targetPath).size).toBe(repaired.bytes);
  });

  test('rejects symlinked storage root', async () => {
    const outside = createRoot();
    const symlinkRoot = path.join(rootDir, 'linked-root');
    fs.symlinkSync(outside, symlinkRoot, 'dir');
    const storage = createSbomStorage({ rootDir: symlinkRoot });

    await expect(
      storage.writeDocument({
        subjectDigest: VALID_DIGEST,
        image: 'registry.example/app:latest',
        format: FORMAT,
        document: {},
      }),
    ).rejects.toThrow('SBOM storage path must not be a symbolic link');
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test('rejects a symlinked nearest ancestor when creating a missing root', async () => {
    const outside = createRoot();
    const linkedParent = path.join(rootDir, 'linked-parent');
    fs.symlinkSync(outside, linkedParent, 'dir');
    const storage = createSbomStorage({ rootDir: path.join(linkedParent, 'missing-root') });

    await expect(
      storage.writeDocument({
        subjectDigest: VALID_DIGEST,
        image: 'registry.example/app:latest',
        format: FORMAT,
        document: {},
      }),
    ).rejects.toThrow('SBOM storage path must not be a symbolic link');
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test('rejects a non-directory storage root', async () => {
    const fileRoot = path.join(rootDir, 'root-file');
    fs.writeFileSync(fileRoot, 'not a directory');
    const storage = createSbomStorage({ rootDir: fileRoot });

    await expect(
      storage.writeDocument({
        image: 'registry.example/app:latest',
        format: FORMAT,
        document: {},
      }),
    ).rejects.toThrow('SBOM storage parent must be a directory');
  });

  test('rejects symlinked storage parent', async () => {
    const outside = createRoot();
    fs.symlinkSync(outside, path.join(rootDir, 'sbom'), 'dir');
    const storage = createSbomStorage({ rootDir });

    await expect(
      storage.writeDocument({
        subjectDigest: VALID_DIGEST,
        image: 'registry.example/app:latest',
        format: FORMAT,
        document: {},
      }),
    ).rejects.toThrow('SBOM storage path must not be a symbolic link');
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test('rejects symlinked and non-directory parents while reading', async () => {
    const hashDirectory = digestDirectory(VALID_DIGEST);
    const ref: SbomDocumentRef = {
      key: `sbom/${hashDirectory}/spdx-json.json`,
      sha256: 'a'.repeat(64),
      bytes: 2,
    };
    const outside = createRoot();
    fs.symlinkSync(outside, path.join(rootDir, 'sbom'), 'dir');
    const storage = createSbomStorage({ rootDir });

    await expect(storage.readDocument(ref, FORMAT)).rejects.toThrow(
      'SBOM storage path must not be a symbolic link',
    );

    fs.rmSync(path.join(rootDir, 'sbom'));
    fs.writeFileSync(path.join(rootDir, 'sbom'), 'not a directory');
    await expect(storage.readDocument(ref, FORMAT)).rejects.toThrow(
      'SBOM storage parent must be a directory',
    );
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test('rejects symlinked document targets on read and write without touching the target', async () => {
    const storage = createSbomStorage({ rootDir });
    const ref = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: { original: true },
    });
    const targetPath = path.join(rootDir, ref.key);
    const outsidePath = path.join(rootDir, 'outside.json');
    fs.writeFileSync(outsidePath, JSON.stringify({ outside: true }), { mode: 0o600 });
    fs.rmSync(targetPath);
    fs.symlinkSync(outsidePath, targetPath);

    await expect(storage.readDocument(ref, FORMAT)).rejects.toThrow(
      'SBOM storage path must not be a symbolic link',
    );
    await expect(
      storage.writeDocument({
        subjectDigest: VALID_DIGEST,
        image: 'registry.example/app:latest',
        format: FORMAT,
        document: { original: true },
      }),
    ).rejects.toThrow('SBOM storage path must not be a symbolic link');
    expect(JSON.parse(fs.readFileSync(outsidePath, 'utf8'))).toEqual({ outside: true });
  });

  test('rejects non-regular document targets', async () => {
    const storage = createSbomStorage({ rootDir });
    const ref = await storage.writeDocument({
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: FORMAT,
      document: { original: true },
    });
    const targetPath = path.join(rootDir, ref.key);
    fs.rmSync(targetPath);
    fs.mkdirSync(targetPath);

    await expect(storage.readDocument(ref, FORMAT)).rejects.toThrow(
      'SBOM document must be a regular file',
    );
    await expect(
      storage.writeDocument({
        subjectDigest: VALID_DIGEST,
        image: 'registry.example/app:latest',
        format: FORMAT,
        document: { original: true },
      }),
    ).rejects.toThrow('SBOM document must be a regular file');
  });

  test('reports missing roots, parents, and documents without creating them', async () => {
    const missingRoot = path.join(rootDir, 'missing-root');
    const storage = createSbomStorage({ rootDir: missingRoot });
    const hashDirectory = digestDirectory(VALID_DIGEST);
    const ref: SbomDocumentRef = {
      key: `sbom/${hashDirectory}/spdx-json.json`,
      sha256: 'a'.repeat(64),
      bytes: 2,
    };

    await expect(storage.readDocument(ref, FORMAT)).rejects.toThrow('SBOM document not found');
    expect(fs.existsSync(missingRoot)).toBe(false);

    fs.mkdirSync(path.join(missingRoot, 'sbom', hashDirectory), {
      recursive: true,
      mode: 0o700,
    });
    await expect(storage.readDocument(ref, FORMAT)).rejects.toThrow('SBOM document not found');
  });

  test('concurrent identical writes converge on one complete document without temp files', async () => {
    const storage = createSbomStorage({ rootDir });
    const input = {
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: 'cyclonedx-json' as const,
      document: {
        bomFormat: 'CycloneDX',
        components: Array.from({ length: 100 }, (_, id) => ({ id })),
      },
    };

    const refs = await Promise.all(Array.from({ length: 12 }, () => storage.writeDocument(input)));

    expect(new Set(refs.map((ref) => JSON.stringify(ref))).size).toBe(1);
    expect(await storage.readDocument(refs[0], input.format)).toEqual(input.document);
    expect(tempFiles(rootDir)).toEqual([]);
  });

  test('keeps divergent digest-addressed regenerations independently readable', async () => {
    const storage = createSbomStorage({ rootDir });
    const base = {
      subjectDigest: VALID_DIGEST,
      image: 'registry.example/app:latest',
      format: 'spdx-json' as const,
    };
    const first = await storage.writeDocument({ ...base, document: { generated: 'first' } });
    const second = await storage.writeDocument({ ...base, document: { generated: 'second' } });

    expect(second.key).not.toBe(first.key);
    await expect(storage.readDocument(first, 'spdx-json')).resolves.toEqual({
      generated: 'first',
    });
    await expect(storage.readDocument(second, 'spdx-json')).resolves.toEqual({
      generated: 'second',
    });
  });
});
