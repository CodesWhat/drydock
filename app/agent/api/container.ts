import type { Request, Response } from 'express';
import { getServerConfiguration } from '../../configuration/index.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';

type AgentDockerWatcher = {
  dockerApi: {
    getContainer: (name: string) => {
      logs: (options: {
        stdout: boolean;
        stderr: boolean;
        tail: number;
        since: number;
        timestamps: boolean;
        follow: boolean;
      }) => Promise<Buffer | string>;
    };
  };
};

/**
 * Get Containers (Handshake).
 */
export function getContainers(req: Request, res: Response) {
  const containers = storeContainer.getContainers();
  res.json(containers);
}

/**
 * Demultiplex Docker stream output.
 * Docker uses an 8-byte header per frame: [streamType(1), padding(3), size(4BE)].
 */
function demuxDockerStream(buffer: Buffer | string): string {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const lines: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > buf.length) break;
    lines.push(buf.subarray(offset, offset + size).toString('utf-8'));
    offset += size;
  }
  return lines.join('');
}

/**
 * Get container logs.
 * @param req
 * @param res
 */
export async function getContainerLogs(req: Request, res: Response) {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const container = storeContainer.getContainer(id);
  if (!container) {
    res.status(404).json({ error: 'Container not found' });
    return;
  }

  const tail = Number.parseInt(req.query.tail as string, 10) || 100;
  const since = Number.parseInt(req.query.since as string, 10) || 0;
  const timestamps = req.query.timestamps !== 'false';

  const watcherId = `docker.${container.watcher}`;
  const watcher = registry.getState().watcher[watcherId] as AgentDockerWatcher | undefined;
  if (!watcher) {
    res.status(500).json({
      error: `No watcher found for container ${id}`,
    });
    return;
  }

  try {
    const logsBuffer = await watcher.dockerApi
      .getContainer(container.name)
      .logs({ stdout: true, stderr: true, tail, since, timestamps, follow: false });
    const logs = demuxDockerStream(logsBuffer);
    res.status(200).json({ logs });
  } catch (e: any) {
    res.status(500).json({
      error: `Error fetching container logs (${e.message})`,
    });
  }
}

/**
 * Delete a container by id.
 * @param req
 * @param res
 */
export function deleteContainer(req: Request, res: Response) {
  const serverConfiguration = getServerConfiguration();
  if (serverConfiguration.feature.delete) {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const container = storeContainer.getContainer(id);
    if (container) {
      storeContainer.deleteContainer(id);
      res.sendStatus(204);
    } else {
      res.status(404).json({ error: 'Container not found' });
    }
  } else {
    res.status(403).json({ error: 'Container deletion is disabled' });
  }
}
