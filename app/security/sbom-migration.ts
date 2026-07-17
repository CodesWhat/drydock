import type { SbomDocumentRef } from './sbom-storage.js';

const SBOM_SLOTS = ['sbom', 'updateSbom'] as const;
type SbomSlot = (typeof SBOM_SLOTS)[number];
type SbomFormat = 'spdx-json' | 'cyclonedx-json';

interface SbomStorageLike {
  writeDocument(options: {
    subjectDigest?: string;
    image: string;
    format: SbomFormat;
    document: unknown;
  }): Promise<SbomDocumentRef>;
  readDocument(ref: SbomDocumentRef, format: SbomFormat): Promise<unknown>;
}

export async function offloadSbomDocuments<T extends MigratableSbomRecord>(options: {
  sbom: T;
  storage: SbomStorageLike;
  subjectDigest?: string;
}): Promise<T> {
  if (!hasInlineDocuments(options.sbom)) {
    return options.sbom;
  }
  const entries = Object.entries(options.sbom.documents) as Array<[SbomFormat, unknown]>;
  const written = await Promise.all(
    entries.map(async ([format, document]) => {
      const ref = await options.storage.writeDocument({
        subjectDigest: options.subjectDigest || options.sbom.subjectDigest,
        image: options.sbom.image || '',
        format,
        document,
      });
      return [format, ref] as const;
    }),
  );
  const { documents: _documents, ...withoutDocuments } = options.sbom;
  return {
    ...withoutDocuments,
    ...(options.subjectDigest ? { subjectDigest: options.subjectDigest } : {}),
    documentRefs: {
      ...(options.sbom.documentRefs || {}),
      ...Object.fromEntries(written),
    },
    documents: undefined,
  } as T;
}

interface MigratableSbomRecord {
  image?: string;
  subjectDigest?: string;
  documents?: Partial<Record<SbomFormat, unknown>>;
  documentRefs?: Partial<Record<SbomFormat, SbomDocumentRef>>;
}

interface MigratableContainer {
  image?: {
    digest?: {
      value?: string;
    };
  };
  result?: {
    digest?: string;
  };
  security?: {
    sbom?: MigratableSbomRecord;
    updateSbom?: MigratableSbomRecord;
  };
}

interface MigrateInlineSbomsOptions<T extends MigratableContainer> {
  containers: readonly T[];
  storage: SbomStorageLike;
  persist(updatedContainer: T): Promise<void> | void;
}

export interface SbomMigrationReport {
  migratedRecords: number;
  migratedDocuments: number;
  failures: number;
}

function hasInlineDocuments(
  record: MigratableSbomRecord | undefined,
): record is MigratableSbomRecord & { documents: Record<string, unknown> } {
  return Boolean(
    record &&
      Object.hasOwn(record, 'documents') &&
      record.documents &&
      typeof record.documents === 'object' &&
      !Array.isArray(record.documents),
  );
}

function getSubjectDigest(
  container: MigratableContainer,
  slot: SbomSlot,
  record: MigratableSbomRecord,
): string | undefined {
  if (typeof record.subjectDigest === 'string' && record.subjectDigest.length > 0) {
    return record.subjectDigest;
  }
  const slotDigest = slot === 'sbom' ? container.image?.digest?.value : container.result?.digest;
  return typeof slotDigest === 'string' && slotDigest.length > 0 ? slotDigest : undefined;
}

function cloneWithMigratedRecord<T extends MigratableContainer>(
  container: T,
  slot: SbomSlot,
  record: MigratableSbomRecord,
  writtenRefs: Partial<Record<SbomFormat, SbomDocumentRef>>,
): T {
  const { documents: _documents, ...recordWithoutDocuments } = record;
  const migratedRecord: MigratableSbomRecord = {
    ...recordWithoutDocuments,
    documentRefs: {
      ...(record.documentRefs || {}),
      ...writtenRefs,
    },
  };
  return {
    ...container,
    security: {
      ...container.security,
      [slot]: migratedRecord,
    },
  } as T;
}

export async function migrateInlineSboms<T extends MigratableContainer>(
  options: MigrateInlineSbomsOptions<T>,
): Promise<SbomMigrationReport> {
  const report: SbomMigrationReport = {
    migratedRecords: 0,
    migratedDocuments: 0,
    failures: 0,
  };

  for (const originalContainer of options.containers) {
    let persistedContainer = originalContainer;

    for (const slot of SBOM_SLOTS) {
      const record = persistedContainer.security?.[slot] as MigratableSbomRecord | undefined;
      if (!hasInlineDocuments(record)) {
        continue;
      }

      const documentEntries = Object.entries(record.documents) as Array<[SbomFormat, unknown]>;
      try {
        if (typeof record.image !== 'string' || record.image.length === 0) {
          throw new Error('SBOM image is required for migration');
        }
        const image = record.image;
        const subjectDigest = getSubjectDigest(persistedContainer, slot, record);
        const writtenEntries = await Promise.all(
          documentEntries.map(async ([format, document]) => {
            const ref = await options.storage.writeDocument({
              subjectDigest,
              image,
              format,
              document,
            });
            return [format, ref] as const;
          }),
        );
        const updatedContainer = cloneWithMigratedRecord(
          persistedContainer,
          slot,
          record,
          Object.fromEntries(writtenEntries),
        );

        await options.persist(updatedContainer);
        persistedContainer = updatedContainer;
        report.migratedRecords += 1;
        report.migratedDocuments += documentEntries.length;
      } catch {
        report.failures += 1;
      }
    }
  }

  return report;
}

export async function dereferenceSbomDocument(
  sbom: MigratableSbomRecord | undefined,
  format: SbomFormat,
  storage: SbomStorageLike,
): Promise<unknown | undefined> {
  if (!sbom) {
    return undefined;
  }
  const documentRef = sbom.documentRefs?.[format];
  if (documentRef) {
    return storage.readDocument(documentRef, format);
  }
  if (sbom.documents && Object.hasOwn(sbom.documents, format)) {
    return sbom.documents[format];
  }
  return undefined;
}
