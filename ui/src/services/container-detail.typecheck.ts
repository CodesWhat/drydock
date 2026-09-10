import type { getBackups } from './backup';
import type { revealContainerEnv } from './container';

declare const backups: Awaited<ReturnType<typeof getBackups>>;
const backupId: string = backups[0].id;
const backupImage: string = backups[0].imageName;
const backupTag: string = backups[0].imageTag;
const backupTimestamp: string = backups[0].timestamp;

declare const revealed: Awaited<ReturnType<typeof revealContainerEnv>>;
const env: { key: string; value: string; sensitive: boolean }[] = revealed.env;

void backupId;
void backupImage;
void backupTag;
void backupTimestamp;
void env;
