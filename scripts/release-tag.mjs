#!/usr/bin/env node

const releaseTagRegex =
  /^v(?<baseVersion>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const numericIdentifierRegex = /^(?:0|[1-9]\d*)$/u;
const digitsOnlyRegex = /^\d+$/u;
const legacyRcRegex = /^rc(?<number>\d+)$/u;

function validatePrerelease(prerelease, tag) {
  if (!prerelease) {
    return;
  }

  for (const identifier of prerelease.split('.')) {
    if (digitsOnlyRegex.test(identifier) && !numericIdentifierRegex.test(identifier)) {
      throw new Error(
        `Invalid prerelease identifier in ${tag}: ${identifier}. Numeric identifiers must not contain leading zeroes.`,
      );
    }
  }

  const legacyRcMatch = prerelease.match(legacyRcRegex);
  if (legacyRcMatch?.groups?.number) {
    const canonicalRcNumber = String(Number(legacyRcMatch.groups.number));
    throw new Error(
      `Invalid RC tag format: ${tag}. Use v${tag.slice(1, tag.lastIndexOf('-'))}-rc.${canonicalRcNumber} instead.`,
    );
  }
}

export function parseReleaseTag(tag) {
  const value = String(tag ?? '').trim();
  const match = value.match(releaseTagRegex);
  if (!match?.groups) {
    throw new Error(`Invalid release tag: ${tag}. Use vX.Y.Z or vX.Y.Z-<prerelease>.`);
  }

  const prerelease = match.groups.prerelease ?? null;
  validatePrerelease(prerelease, value);

  return {
    tag: value,
    baseVersion: match.groups.baseVersion,
    prerelease,
    isPrerelease: prerelease !== null,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--')) {
      continue;
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for argument: ${key}`);
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tag) {
    throw new Error('--tag is required');
  }

  const metadata = parseReleaseTag(args.tag);
  console.log(`base_version=${metadata.baseVersion}`);
  console.log(`is_prerelease=${metadata.isPrerelease}`);
  console.log(`prerelease=${metadata.prerelease ?? ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
