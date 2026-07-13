import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dereferenceSbomDocument,
  migrateInlineSboms,
  offloadSbomDocuments,
} from './sbom-migration.js';
import { createSbomStorage, type SbomDocumentRef } from './sbom-storage.js';

const CURRENT_DIGEST = `sha256:${'1a'.repeat(32)}`;
const UPDATE_DIGEST = `sha256:${'2b'.repeat(32)}`;

function createRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-sbom-migration-'));
}

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'container-1',
    name: 'web',
    image: {
      digest: { value: CURRENT_DIGEST },
    },
    result: {
      digest: UPDATE_DIGEST,
    },
    security: {
      scan: { status: 'passed' },
      sbom: {
        generator: 'trivy',
        image: 'registry.example/web:current',
        generatedAt: '2026-07-12T00:00:00.000Z',
        status: 'generated',
        formats: ['spdx-json', 'cyclonedx-json'],
        documents: {
          'spdx-json': { SPDXID: 'SPDXRef-CURRENT' },
          'cyclonedx-json': { bomFormat: 'CycloneDX', serialNumber: 'current' },
        },
      },
      updateSbom: {
        generator: 'trivy',
        image: 'registry.example/web:update',
        generatedAt: '2026-07-12T00:01:00.000Z',
        status: 'generated',
        formats: ['spdx-json'],
        documents: {
          'spdx-json': { SPDXID: 'SPDXRef-UPDATE' },
        },
      },
    },
    ...overrides,
  };
}

describe('live SBOM offloading', () => {
  test('returns reference-only records unchanged', async () => {
    const sbom = {
      image: 'registry.example/web:current',
      documentRefs: {
        'spdx-json': {
          key: `sbom/${'a'.repeat(64)}/spdx-json.json`,
          sha256: 'b'.repeat(64),
          bytes: 42,
        },
      },
    };
    const storage = {
      writeDocument: vi.fn(),
      readDocument: vi.fn(),
    };

    await expect(offloadSbomDocuments({ sbom, storage })).resolves.toBe(sbom);
    expect(storage.writeDocument).not.toHaveBeenCalled();
  });

  test('stores inline documents and merges existing references', async () => {
    const existingRef = {
      key: `sbom/${'a'.repeat(64)}/cyclonedx-json.json`,
      sha256: 'b'.repeat(64),
      bytes: 42,
    };
    const writtenRef = {
      key: `sbom/${'c'.repeat(64)}/spdx-json.json`,
      sha256: 'd'.repeat(64),
      bytes: 84,
    };
    const storage = {
      writeDocument: vi.fn(async () => writtenRef),
      readDocument: vi.fn(),
    };
    const sbom = {
      image: 'registry.example/web:current',
      subjectDigest: CURRENT_DIGEST,
      documents: { 'spdx-json': { SPDXID: 'SPDXRef-LIVE' } },
      documentRefs: { 'cyclonedx-json': existingRef },
    };

    const offloaded = await offloadSbomDocuments({
      sbom,
      storage,
      subjectDigest: UPDATE_DIGEST,
    });

    expect(storage.writeDocument).toHaveBeenCalledWith({
      subjectDigest: UPDATE_DIGEST,
      image: 'registry.example/web:current',
      format: 'spdx-json',
      document: { SPDXID: 'SPDXRef-LIVE' },
    });
    expect(offloaded).toEqual({
      image: 'registry.example/web:current',
      subjectDigest: UPDATE_DIGEST,
      documentRefs: {
        'cyclonedx-json': existingRef,
        'spdx-json': writtenRef,
      },
      documents: undefined,
    });
    expect(sbom.documents).toEqual({ 'spdx-json': { SPDXID: 'SPDXRef-LIVE' } });
  });

  test('falls back to record metadata for legacy inline records', async () => {
    const storage = {
      writeDocument: vi.fn(async () => ({
        key: `sbom/${'a'.repeat(64)}/spdx-json.json`,
        sha256: 'b'.repeat(64),
        bytes: 2,
      })),
      readDocument: vi.fn(),
    };
    const sbom = {
      subjectDigest: CURRENT_DIGEST,
      documents: { 'spdx-json': {} },
    };

    await offloadSbomDocuments({ sbom, storage });

    expect(storage.writeDocument).toHaveBeenCalledWith({
      subjectDigest: CURRENT_DIGEST,
      image: '',
      format: 'spdx-json',
      document: {},
    });
  });
});

describe('inline SBOM migration', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = createRoot();
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  test('migrates current and update records one record at a time without mutating input', async () => {
    const storage = createSbomStorage({ rootDir });
    const container = createContainer();
    const original = structuredClone(container);
    const persisted: Array<Record<string, any>> = [];

    const report = await migrateInlineSboms({
      containers: [container],
      storage,
      persist: async (updated) => {
        persisted.push(updated);
      },
    });

    expect(report).toEqual({ migratedRecords: 2, migratedDocuments: 3, failures: 0 });
    expect(container).toEqual(original);
    expect(persisted).toHaveLength(2);

    expect(persisted[0]).not.toBe(container);
    expect(persisted[0].security).not.toBe(container.security);
    expect(persisted[0].security.sbom.documents).toBeUndefined();
    expect(persisted[0].security.sbom.documentRefs).toEqual({
      'spdx-json': expect.objectContaining({ key: expect.stringMatching(/^sbom\/[a-f0-9]{64}\//) }),
      'cyclonedx-json': expect.objectContaining({
        key: expect.stringMatching(/^sbom\/[a-f0-9]{64}\//),
      }),
    });
    expect(persisted[0].security.updateSbom.documents).toEqual(
      original.security.updateSbom.documents,
    );
    expect(persisted[0].security.scan).toEqual({ status: 'passed' });

    const finalContainer = persisted[1];
    expect(finalContainer.security.sbom.documents).toBeUndefined();
    expect(finalContainer.security.updateSbom.documents).toBeUndefined();
    expect(finalContainer.security.updateSbom.documentRefs['spdx-json']).toEqual(
      expect.objectContaining({ key: expect.stringMatching(/^sbom\/[a-f0-9]{64}\//) }),
    );

    await expect(
      dereferenceSbomDocument(finalContainer.security.sbom, 'spdx-json', storage),
    ).resolves.toEqual({ SPDXID: 'SPDXRef-CURRENT' });
    await expect(
      dereferenceSbomDocument(finalContainer.security.updateSbom, 'spdx-json', storage),
    ).resolves.toEqual({ SPDXID: 'SPDXRef-UPDATE' });
  });

  test('passes current and update subject digests to storage', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const storage = {
      writeDocument: vi.fn(async (options) => {
        writes.push(options);
        return {
          key: `sbom/${'a'.repeat(64)}/${options.format}.json`,
          sha256: 'b'.repeat(64),
          bytes: 2,
        };
      }),
      readDocument: vi.fn(),
    };

    await migrateInlineSboms({
      containers: [createContainer()],
      storage,
      persist: vi.fn(async () => undefined),
    });

    expect(writes.filter((write) => write.image === 'registry.example/web:current')).toEqual([
      expect.objectContaining({ subjectDigest: CURRENT_DIGEST, format: 'spdx-json' }),
      expect.objectContaining({ subjectDigest: CURRENT_DIGEST, format: 'cyclonedx-json' }),
    ]);
    expect(writes.filter((write) => write.image === 'registry.example/web:update')).toEqual([
      expect.objectContaining({ subjectDigest: UPDATE_DIGEST, format: 'spdx-json' }),
    ]);
  });

  test('uses an SBOM record subject digest before the container slot digest', async () => {
    const recordDigest = `sha256:${'3c'.repeat(32)}`;
    const container = createContainer();
    (container.security.sbom as Record<string, unknown>).subjectDigest = recordDigest;
    const storage = {
      writeDocument: vi.fn(async (options) => ({
        key: `sbom/${'a'.repeat(64)}/${options.format}.json`,
        sha256: 'b'.repeat(64),
        bytes: 2,
      })),
      readDocument: vi.fn(),
    };

    await migrateInlineSboms({
      containers: [container],
      storage,
      persist: vi.fn(async () => undefined),
    });

    expect(storage.writeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectDigest: recordDigest,
        image: 'registry.example/web:current',
      }),
    );
  });

  test('falls back to image addressing when no subject digest exists', async () => {
    const container = createContainer({
      image: { digest: {} },
      result: {},
    });
    const storage = {
      writeDocument: vi.fn(async (options) => ({
        key: `sbom/${'a'.repeat(64)}/${options.format}.json`,
        sha256: 'b'.repeat(64),
        bytes: 2,
      })),
      readDocument: vi.fn(),
    };

    await migrateInlineSboms({
      containers: [container],
      storage,
      persist: vi.fn(async () => undefined),
    });

    expect(storage.writeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectDigest: undefined,
        image: 'registry.example/web:current',
      }),
    );
  });

  test('preserves the whole original record when any format write fails', async () => {
    const container = createContainer();
    const original = structuredClone(container);
    const storage = {
      writeDocument: vi.fn(async ({ format }) => {
        if (format === 'cyclonedx-json') {
          throw new Error('disk full');
        }
        return {
          key: `sbom/${'a'.repeat(64)}/${format}.json`,
          sha256: 'b'.repeat(64),
          bytes: 2,
        };
      }),
      readDocument: vi.fn(),
    };
    const persist = vi.fn(async (_updated: Record<string, any>) => undefined);

    const report = await migrateInlineSboms({ containers: [container], storage, persist });

    expect(report).toEqual({ migratedRecords: 1, migratedDocuments: 1, failures: 1 });
    expect(persist).toHaveBeenCalledOnce();
    const persistedUpdate = persist.mock.calls[0][0];
    expect(persistedUpdate.security.sbom).toEqual(original.security.sbom);
    expect(persistedUpdate.security.updateSbom.documents).toBeUndefined();
    expect(container).toEqual(original);
  });

  test.each([undefined, ''])('preserves a legacy record with invalid image %j', async (image) => {
    const base = createContainer();
    const container = createContainer({
      security: {
        sbom: {
          ...base.security.sbom,
          image,
        },
      },
    });
    const storage = {
      writeDocument: vi.fn(),
      readDocument: vi.fn(),
    };
    const persist = vi.fn();

    const report = await migrateInlineSboms({ containers: [container], storage, persist });

    expect(report).toEqual({ migratedRecords: 0, migratedDocuments: 0, failures: 1 });
    expect(storage.writeDocument).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  test('preserves the original record and reports failure when persistence fails', async () => {
    const storage = createSbomStorage({ rootDir });
    const container = createContainer({
      security: {
        sbom: createContainer().security.sbom,
      },
    });
    const original = structuredClone(container);
    const persist = vi.fn(async (_updated: Record<string, any>) => {
      throw new Error('store unavailable');
    });

    const report = await migrateInlineSboms({ containers: [container], storage, persist });

    expect(report).toEqual({ migratedRecords: 0, migratedDocuments: 0, failures: 1 });
    expect(container).toEqual(original);
    expect(persist.mock.calls[0][0].security.sbom.documents).toBeUndefined();
  });

  test('is idempotent when restarted from the last persisted clone', async () => {
    const storage = createSbomStorage({ rootDir });
    let persistedContainer: Record<string, any> | undefined;
    const first = await migrateInlineSboms({
      containers: [createContainer()],
      storage,
      persist: async (updated) => {
        persistedContainer = updated;
      },
    });
    expect(first).toEqual({ migratedRecords: 2, migratedDocuments: 3, failures: 0 });

    const persistAgain = vi.fn(async () => undefined);
    const second = await migrateInlineSboms({
      containers: [persistedContainer!],
      storage,
      persist: persistAgain,
    });

    expect(second).toEqual({ migratedRecords: 0, migratedDocuments: 0, failures: 0 });
    expect(persistAgain).not.toHaveBeenCalled();
  });

  test('identical image digests share document references across containers', async () => {
    const storage = createSbomStorage({ rootDir });
    const document = { SPDXID: 'SPDXRef-SHARED' };
    const containers = ['container-a', 'container-b'].map((id) =>
      createContainer({
        id,
        security: {
          sbom: {
            ...createContainer().security.sbom,
            formats: ['spdx-json'],
            documents: { 'spdx-json': document },
          },
        },
      }),
    );
    const persisted: Array<Record<string, any>> = [];

    const report = await migrateInlineSboms({
      containers,
      storage,
      persist: async (updated) => {
        persisted.push(updated);
      },
    });

    expect(report).toEqual({ migratedRecords: 2, migratedDocuments: 2, failures: 0 });
    expect(persisted[0].security.sbom.documentRefs['spdx-json']).toEqual(
      persisted[1].security.sbom.documentRefs['spdx-json'],
    );
    const files = fs
      .readdirSync(path.join(rootDir, 'sbom'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name === 'spdx-json.json');
    expect(files).toHaveLength(1);
  });

  test('merges existing references while removing inline documents', async () => {
    const existingRef: SbomDocumentRef = {
      key: `sbom/${'c'.repeat(64)}/cyclonedx-json.json`,
      sha256: 'd'.repeat(64),
      bytes: 10,
    };
    const base = createContainer();
    const container = createContainer({
      security: {
        sbom: {
          ...base.security.sbom,
          formats: ['spdx-json', 'cyclonedx-json'],
          documents: { 'spdx-json': { SPDXID: 'SPDXRef-NEW' } },
          documentRefs: { 'cyclonedx-json': existingRef },
        },
      },
    });
    const storage = createSbomStorage({ rootDir });
    const persist = vi.fn(async (_updated: Record<string, any>) => undefined);

    await migrateInlineSboms({ containers: [container], storage, persist });

    expect(persist.mock.calls[0][0].security.sbom.documentRefs).toEqual({
      'cyclonedx-json': existingRef,
      'spdx-json': expect.any(Object),
    });
    expect(persist.mock.calls[0][0].security.sbom.documents).toBeUndefined();
  });

  test('skips containers and records without inline documents', async () => {
    const persist = vi.fn(async () => undefined);
    const storage = {
      writeDocument: vi.fn(),
      readDocument: vi.fn(),
    };

    const report = await migrateInlineSboms({
      containers: [
        { id: 'no-security' },
        { id: 'empty-security', security: {} },
        {
          id: 'already-migrated',
          security: {
            sbom: {
              image: 'image',
              documentRefs: {},
            },
          },
        },
      ],
      storage,
      persist,
    });

    expect(report).toEqual({ migratedRecords: 0, migratedDocuments: 0, failures: 0 });
    expect(storage.writeDocument).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('SBOM dereferencing during migration', () => {
  test('reads a document reference when present', async () => {
    const ref: SbomDocumentRef = {
      key: `sbom/${'a'.repeat(64)}/spdx-json.json`,
      sha256: 'b'.repeat(64),
      bytes: 2,
    };
    const storage = {
      writeDocument: vi.fn(),
      readDocument: vi.fn(async () => ({ from: 'disk' })),
    };

    await expect(
      dereferenceSbomDocument(
        {
          documentRefs: { 'spdx-json': ref },
          documents: { 'spdx-json': { from: 'inline' } },
        },
        'spdx-json',
        storage,
      ),
    ).resolves.toEqual({ from: 'disk' });
    expect(storage.readDocument).toHaveBeenCalledWith(ref, 'spdx-json');
  });

  test('returns the legacy inline document when no reference exists', async () => {
    const storage = {
      writeDocument: vi.fn(),
      readDocument: vi.fn(),
    };
    const inline = { SPDXID: 'SPDXRef-LEGACY' };

    await expect(
      dereferenceSbomDocument({ documents: { 'spdx-json': inline } }, 'spdx-json', storage),
    ).resolves.toBe(inline);
    expect(storage.readDocument).not.toHaveBeenCalled();
  });

  test('returns undefined when the record or requested format is unavailable', async () => {
    const storage = {
      writeDocument: vi.fn(),
      readDocument: vi.fn(),
    };

    await expect(dereferenceSbomDocument(undefined, 'spdx-json', storage)).resolves.toBeUndefined();
    await expect(
      dereferenceSbomDocument({ documents: {} }, 'spdx-json', storage),
    ).resolves.toBeUndefined();
  });
});
