// @ts-nocheck
import type { Request, Response } from 'express';

export function createLogHandlers({ storeContainer, getAgent, getWatchers, getErrorMessage }) {
  /**
   * Demultiplex Docker stream output.
   * Docker uses an 8-byte header per frame: [streamType(1), padding(3), size(4BE)].
   * This strips those headers and returns the raw log text.
   */
  function demuxDockerStream(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const lines = [];
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
  async function getContainerLogs(req: Request, res: Response) {
    const { id } = req.params;
    const container = storeContainer.getContainer(id);
    if (!container) {
      res.sendStatus(404);
      return;
    }

    const tail = Number.parseInt(req.query.tail, 10) || 100;
    const since = Number.parseInt(req.query.since, 10) || 0;
    const timestamps = req.query.timestamps !== 'false';

    if (container.agent) {
      try {
        const agent = getAgent(container.agent);
        if (!agent) {
          res.status(500).json({
            error: `Agent ${container.agent} not found`,
          });
          return;
        }
        const result = await agent.getContainerLogs(id, { tail, since, timestamps });
        res.status(200).json(result);
      } catch (error: unknown) {
        res.status(500).json({
          error: `Error fetching logs from agent (${getErrorMessage(error)})`,
        });
      }
      return;
    }

    const watcherId = `docker.${container.watcher}`;
    const watcher = getWatchers()[watcherId];
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
    } catch (error: unknown) {
      res.status(500).json({
        error: `Error fetching container logs (${getErrorMessage(error)})`,
      });
    }
  }

  return {
    getContainerLogs,
  };
}
