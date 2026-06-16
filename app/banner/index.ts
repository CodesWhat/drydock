import { getVersion } from '../configuration/index.js';
import { BANNER_ART, BANNER_WIDTH } from './art.js';

export function renderBanner(
  options: { mode: string; stream?: NodeJS.WriteStream; env?: NodeJS.ProcessEnv } = {
    mode: 'controller',
  },
): void {
  const stream = options.stream ?? process.stderr;
  const env = options.env ?? process.env;

  if (!stream.isTTY || (env.NO_COLOR !== undefined && env.NO_COLOR !== '')) {
    return;
  }

  const version = getVersion();
  const pad =
    typeof stream.columns === 'number' && stream.columns > BANNER_WIDTH
      ? ' '.repeat(Math.floor((stream.columns - BANNER_WIDTH) / 2))
      : '';

  const paddedArt = BANNER_ART.split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');

  const identity = `\x1b[1mdrydock v${version} · ${options.mode}\x1b[0m`;
  const paddedIdentity = `${pad}${identity}`;

  stream.write(`${paddedArt}\n${paddedIdentity}\n`);
}
