import type { useSbomDetail } from '../composables/useSbomDetail';
import type { SbomState } from '../views/security/securityViewTypes';
import type { getBackups } from './backup';
import type { getContainerSbom, revealContainerEnv } from './container';

declare const backups: Awaited<ReturnType<typeof getBackups>>;
const backupId: string = backups[0].id;
const backupImage: string = backups[0].imageName;
const backupTag: string = backups[0].imageTag;
const backupTimestamp: string = backups[0].timestamp;

declare const revealed: Awaited<ReturnType<typeof revealContainerEnv>>;
const env: { key: string; value: string; sensitive: boolean }[] = revealed.env;

declare const sbom: Awaited<ReturnType<typeof getContainerSbom>>;
const generatedAt: string | undefined = sbom.generatedAt;
// @ts-expect-error opaque SBOM documents must be narrowed before reading package fields
const uncheckedPackages = sbom.document.packages;
declare const detail: ReturnType<typeof useSbomDetail>;
const detailGeneratedAt: SbomState['generatedAt'] = detail.detailSbomGeneratedAt.value;
const detailDocument: SbomState['document'] = detail.detailSbomDocument.value;

void backupId;
void backupImage;
void backupTag;
void backupTimestamp;
void env;
void generatedAt;
void uncheckedPackages;
void detailGeneratedAt;
void detailDocument;
