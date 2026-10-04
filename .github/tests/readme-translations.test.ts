import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const translatedReadmes = [
  'README.de.md',
  'README.es.md',
  'README.fr.md',
  'README.pl.md',
  'README.pt-BR.md',
  'README.zh-CN.md',
];
const allReadmes = ['README.md', ...translatedReadmes];
const sourceReadme = readFileSync(`${repoRoot}/README.md`, 'utf8');
const sourceUrls = [...sourceReadme.matchAll(/https?:\/\/[^)<>"\s]+/g)].map(([url]) => url).sort();
const localizedSurfaceFragments: Record<
  string,
  {
    featureTableHeader: string;
    builtWithHeading: string;
    communityQaHeading: string;
  }
> = {
  'README.de.md': {
    featureTableHeader: '| | Funktion | Beschreibung |',
    builtWithHeading: '<h2 align="center" id="built-with">Gebaut mit</h2>',
    communityQaHeading: '### Community-QA',
  },
  'README.es.md': {
    featureTableHeader: '| | Característica | Descripción |',
    builtWithHeading: '<h2 align="center" id="built-with">Construido con</h2>',
    communityQaHeading: '### Control de calidad de la comunidad',
  },
  'README.fr.md': {
    featureTableHeader: '| | Fonctionnalité | Descriptif |',
    builtWithHeading: '<h2 align="center" id="built-with">Construit avec</h2>',
    communityQaHeading: '### Contrôle qualité de la communauté',
  },
  'README.pl.md': {
    featureTableHeader: '| | Funkcja | Opis |',
    builtWithHeading: '<h2 align="center" id="built-with">Zbudowany z</h2>',
    communityQaHeading: '### Kontrola jakości społeczności',
  },
  'README.pt-BR.md': {
    featureTableHeader: '| | Recurso | Descrição |',
    builtWithHeading: '<h2 align="center" id="built-with">Construído com</h2>',
    communityQaHeading: '### Controle de qualidade da comunidade',
  },
  'README.zh-CN.md': {
    featureTableHeader: '| |特色|描述 |',
    builtWithHeading: '<h2 align="center" id="built-with">技术栈</h2>',
    communityQaHeading: '### 社区质量检查',
  },
};

const balancedTagPairs = [
  { name: 'details', opening: /<details(?:\s[^>]*)?>/g, closing: /<\/details>/g },
  { name: 'summary', opening: /<summary>/g, closing: /<\/summary>/g },
  { name: 'emphasis', opening: /<em>/g, closing: /<\/em>/g },
];

const forbiddenSourceEnglishProse = [
  'Most tools force a tradeoff.',
  'Nothing changes until you say so.',
  'Data based on publicly available documentation as of March 2026.',
  'Drydock v1.6 no longer loads `WUD_*` environment variables',
  'This direction covers at least the next twelve months',
  'High-level themes only; see [CHANGELOG.md](CHANGELOG.md)',
];

const requiredFragments = [
  'img.shields.io/github/v/release/CodesWhat/drydock?include_prereleases',
  'img.shields.io/github/license/CodesWhat/drydock',
  'img.shields.io/docker/pulls/codeswhat/drydock',
  'img.shields.io/github/stars/CodesWhat/drydock',
  'https://www.bestpractices.dev/projects/11915',
  '`drydock.sid`',
  '`allowmetadata=true`',
  '`DD_NOTIFICATION_HTTP_*`',
  'DEPRECATIONS.md#enforced-security-changes-no-deprecation-window',
  'Portwing 0.9.0+',
  'Standard HTTP',
  '`DD_EXPERIMENTAL_PORTWING=false`',
  '2027',
  '[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)',
  '[`GOVERNANCE.md`](GOVERNANCE.md)',
  '[`SECURITY-ASSURANCE.md`](SECURITY-ASSURANCE.md)',
  '[`SECURITY.md`](SECURITY.md)',
  'https://github.com/CodesWhat/drydock/stargazers',
  'docs/assets/star-history.svg',
];

describe.each(translatedReadmes)('%s', (readme) => {
  const content = readFileSync(`${repoRoot}/${readme}`, 'utf8');

  test('carries every current language-neutral README contract', () => {
    for (const fragment of requiredFragments) {
      expect(content, `missing ${fragment}`).toContain(fragment);
    }
  });

  test('carries both security migration warnings', () => {
    expect(content.match(/^> \[!WARNING\]$/gm)).toHaveLength(2);
    expect(content).toContain('`401`');
    expect(content).toContain('`503`');
  });

  test('does not retain superseded release or star-history markup', () => {
    expect(content).not.toContain('img.shields.io/badge/version-');
    expect(content).not.toContain('GHCR-150K%2B_pulls');
    expect(content).not.toContain('https://api.star-history.com/svg');
    expect(content).not.toContain('https://star-history.com/#');
  });

  test('keeps public README labels in the target language', () => {
    const surface = localizedSurfaceFragments[readme];
    expect(content).toContain(surface.featureTableHeader);
    expect(content).toContain(surface.builtWithHeading);
    expect(content).toContain(surface.communityQaHeading);
  });

  test('carries no per-release highlights block', () => {
    expect(content).not.toMatch(/<summary><strong>[^<]*v\d+\.\d+[^<]*<\/strong><\/summary>/);
    expect(content).not.toContain('id="recent-updates"');
  });

  test('preserves the exact source URL multiset', () => {
    const urls = [...content.matchAll(/https?:\/\/[^)<>"\s]+/g)].map(([url]) => url).sort();

    expect(urls).toEqual(sourceUrls);
  });

  test('does not splice source-English prose into translated copy', () => {
    for (const prose of forbiddenSourceEnglishProse) {
      expect(content, `unexpected source-English prose: ${prose}`).not.toContain(prose);
    }
  });
});

describe.each(allReadmes)('%s release notes', (readme) => {
  const content = readFileSync(`${repoRoot}/${readme}`, 'utf8');

  test('keeps release highlights in CHANGELOG.md and GitHub Releases, not the README', () => {
    expect(content).not.toMatch(/<summary><strong>[^<]*v\d+\.\d+[^<]*<\/strong><\/summary>/);
    expect(content).toContain('[`CHANGELOG.md`](CHANGELOG.md)');
    expect(content).toContain('https://github.com/CodesWhat/drydock/releases)');
  });
});

describe.each(allReadmes)('%s star history', (readme) => {
  const content = readFileSync(`${repoRoot}/${readme}`, 'utf8');

  test('uses only the committed star-history chart', () => {
    // The chart must be the committed asset wired into the actual <img>, not
    // merely mentioned somewhere in the file.
    expect(content).toMatch(/<img[^>]*src="docs\/assets\/star-history\.svg"/);
    // Match the retired hosts, not particular URL shapes. `star-history.com/#`
    // only caught the embed form, so a bare https://star-history.com/CodesWhat/
    // drydock link would have walked straight back in. The host assertion also
    // subsumes api.star-history.com. warpchart.dev is retired too: Warpchart
    // was the D12 replacement candidate before that decision was reversed in
    // favor of a committed SVG refreshed by a scheduled workflow. The retired
    // self-hosted route is forbidden in any attribute (src/href), absolute or
    // same-origin, but stays mentionable in prose: the v1.6.0 release-history
    // bullets describe what shipped and frozen history is never rewritten.
    expect(content).not.toContain('star-history.com');
    expect(content).not.toMatch(/=["'][^"']*\/api\/star-history/);
    expect(content).not.toContain('getdrydock.com/api/star-history');
    expect(content).not.toContain('warpchart.dev');
  });
});

describe('apps/web source', () => {
  const webSrcRoot = `${repoRoot}/apps/web/src`;
  const webSourceFiles = readdirSync(webSrcRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => /\.(ts|tsx|mjs|js|jsx|json|css|mdx?)$/.test(path));

  test('carries no retired star-history surface', () => {
    expect(webSourceFiles.length).toBeGreaterThan(0);
    for (const path of webSourceFiles) {
      const source = readFileSync(path, 'utf8');
      for (const retired of ['star-history.com', '/api/star-history', 'warpchart.dev']) {
        expect(source, `${path} references retired surface ${retired}`).not.toContain(retired);
      }
    }
  });
});

describe.each(allReadmes)('%s markup', (readme) => {
  const content = readFileSync(`${repoRoot}/${readme}`, 'utf8');

  test.each(balancedTagPairs)('balances $name tags', ({ opening, closing }) => {
    const openingCount = content.match(opening)?.length ?? 0;
    const closingCount = content.match(closing)?.length ?? 0;

    expect(openingCount).toBe(closingCount);
  });
});
