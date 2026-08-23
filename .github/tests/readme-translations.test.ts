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
const localizedBehaviorFragments: Record<
  string,
  { homeAssistantUpdate: string; portwingEventSource: string; rawInventoryAuthority: string }
> = {
  'README.de.md': {
    homeAssistantUpdate: 'Installieren-Schaltfläche ein echtes Update auslöst',
    portwingEventSource: 'Portwing bleibt Ereignisquelle',
    rawInventoryAuthority: 'Rohinventar kann Controller-Ergebnisse nicht löschen',
  },
  'README.es.md': {
    homeAssistantUpdate: 'botón Instalar ejecuta una actualización real',
    portwingEventSource: 'Portwing sigue siendo la fuente de eventos',
    rawInventoryAuthority: 'inventario sin procesar no puede borrar resultados del controlador',
  },
  'README.fr.md': {
    homeAssistantUpdate: 'bouton Installer déclenche une véritable mise à jour',
    portwingEventSource: 'Portwing reste la source des événements de cycle de vie',
    rawInventoryAuthority:
      'inventaire brut ne peut pas effacer les résultats de mise à jour enrichis par le contrôleur',
  },
  'README.pl.md': {
    homeAssistantUpdate: 'przycisk Instaluj uruchamia rzeczywistą aktualizację',
    portwingEventSource: 'Portwing pozostaje źródłem zdarzeń cyklu życia',
    rawInventoryAuthority:
      'surowy spis nie może usunąć wyników aktualizacji wzbogaconych przez kontroler',
  },
  'README.pt-BR.md': {
    homeAssistantUpdate: 'botão Instalar aciona uma atualização real',
    portwingEventSource: 'Portwing continua sendo a fonte de eventos de ciclo de vida',
    rawInventoryAuthority:
      'inventário bruto não pode apagar resultados de atualização enriquecidos pelo controlador',
  },
  'README.zh-CN.md': {
    homeAssistantUpdate: '“安装”按钮会触发实际更新',
    portwingEventSource: 'Portwing 仍是生命周期事件源',
    rawInventoryAuthority: '原始清单无法抹除控制器增强的更新结果',
  },
};

const localizedSurfaceFragments: Record<
  string,
  {
    featureTableHeader: string;
    builtWithHeading: string;
    communityQaHeading: string;
    releaseHeading: string;
  }
> = {
  'README.de.md': {
    featureTableHeader: '| | Funktion | Beschreibung |',
    builtWithHeading: '<h2 align="center" id="built-with">Gebaut mit</h2>',
    communityQaHeading: '### Community-QA',
    releaseHeading: '<summary><strong>Highlights von v1.7.0-rc.3</strong></summary>',
  },
  'README.es.md': {
    featureTableHeader: '| | Característica | Descripción |',
    builtWithHeading: '<h2 align="center" id="built-with">Construido con</h2>',
    communityQaHeading: '### Control de calidad de la comunidad',
    releaseHeading: '<summary><strong>Aspectos destacados de v1.7.0-rc.3</strong></summary>',
  },
  'README.fr.md': {
    featureTableHeader: '| | Fonctionnalité | Descriptif |',
    builtWithHeading: '<h2 align="center" id="built-with">Construit avec</h2>',
    communityQaHeading: '### Contrôle qualité de la communauté',
    releaseHeading: '<summary><strong>Points forts de la v1.7.0-rc.3</strong></summary>',
  },
  'README.pl.md': {
    featureTableHeader: '| | Funkcja | Opis |',
    builtWithHeading: '<h2 align="center" id="built-with">Zbudowany z</h2>',
    communityQaHeading: '### Kontrola jakości społeczności',
    releaseHeading:
      '<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.3</strong></summary>',
  },
  'README.pt-BR.md': {
    featureTableHeader: '| | Recurso | Descrição |',
    builtWithHeading: '<h2 align="center" id="built-with">Construído com</h2>',
    communityQaHeading: '### Controle de qualidade da comunidade',
    releaseHeading: '<summary><strong>Destaques da v1.7.0-rc.3</strong></summary>',
  },
  'README.zh-CN.md': {
    featureTableHeader: '| |特色|描述 |',
    builtWithHeading: '<h2 align="center" id="built-with">技术栈</h2>',
    communityQaHeading: '### 社区质量检查',
    releaseHeading: '<summary><strong>v1.7.0-rc.3 亮点</strong></summary>',
  },
};

const localizedReleaseFragments: Record<
  string,
  { portwingEdgeBodies: string; mainIsReleasedMonitor: string }
> = {
  'README.de.md': {
    portwingEdgeBodies: '**Portwing-Edge-Tunnel übertragen jetzt Nicht-JSON-Antworten**',
    mainIsReleasedMonitor: '**Ein täglicher Monitor prüft, dass `main` einen Release-Tag trägt**',
  },
  'README.es.md': {
    portwingEdgeBodies:
      '**Los túneles de borde de Portwing ahora transportan cuerpos que no son JSON**',
    mainIsReleasedMonitor:
      '**Un monitor diario verifica que `main` lleve una etiqueta de versión**',
  },
  'README.fr.md': {
    portwingEdgeBodies: '**Les tunnels Portwing edge transportent désormais des corps non JSON**',
    mainIsReleasedMonitor:
      '**Un contrôle quotidien vérifie que `main` porte une étiquette de version**',
  },
  'README.pl.md': {
    portwingEdgeBodies: '**Tunele brzegowe Portwing przenoszą teraz treści inne niż JSON**',
    mainIsReleasedMonitor: '**Codzienny monitor sprawdza, czy `main` ma tag wydania**',
  },
  'README.pt-BR.md': {
    portwingEdgeBodies: '**Túneis de borda do Portwing agora carregam corpos que não são JSON**',
    mainIsReleasedMonitor: '**Um monitor diário verifica se `main` carrega uma tag de versão**',
  },
  'README.zh-CN.md': {
    portwingEdgeBodies: '**Portwing 边缘隧道现在可传输非 JSON 响应体**',
    mainIsReleasedMonitor: '**每日监控确认 `main` 携带发布标签**',
  },
};

const balancedTagPairs = [
  { name: 'details', opening: /<details(?:\s[^>]*)?>/g, closing: /<\/details>/g },
  { name: 'summary', opening: /<summary>/g, closing: /<\/summary>/g },
  { name: 'emphasis', opening: /<em>/g, closing: /<\/em>/g },
];

function getReleaseBlock(content: string, heading: string): string {
  const headingIndex = content.indexOf(heading);
  const startIndex = content.lastIndexOf('<details', headingIndex);
  const endIndex = content.indexOf('</details>', headingIndex);

  if (headingIndex === -1 || startIndex === -1 || endIndex === -1) {
    throw new Error(`could not find release block for ${heading}`);
  }

  return content.slice(startIndex, endIndex);
}

function getBullet(block: string, fragment: string): string | undefined {
  return block.split('\n').find((line) => line.startsWith('- ') && line.includes(fragment));
}

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
  'v1.6.0-rc.13',
  'v1.6.0-rc.12',
  'v1.6.0-rc.11',
  './CHANGELOG.md#160--2026-08-11',
  './CHANGELOG.md#170-rc1--2026-08-14',
  './CHANGELOG.md#170-rc2--2026-08-20',
  './CHANGELOG.md#170-rc3--2026-08-23',
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

  test('preserves Home Assistant update and Portwing result-authority behavior', () => {
    const behavior = localizedBehaviorFragments[readme];
    expect(content).toContain(behavior.homeAssistantUpdate);
    expect(content).toContain(behavior.portwingEventSource);
    expect(content).toContain(behavior.rawInventoryAuthority);
  });

  test('keeps public README labels in the target language', () => {
    const surface = localizedSurfaceFragments[readme];
    expect(content).toContain(surface.featureTableHeader);
    expect(content).toContain(surface.builtWithHeading);
    expect(content).toContain(surface.communityQaHeading);
    expect(content).toContain(surface.releaseHeading);
  });

  test('maps localized v1.7 release bullets to their source links', () => {
    const surface = localizedSurfaceFragments[readme];
    const release = localizedReleaseFragments[readme];
    const releaseBlock = getReleaseBlock(content, surface.releaseHeading);
    const portwingEdgeBullet = getBullet(releaseBlock, release.portwingEdgeBodies);
    const mainMonitorBullet = getBullet(releaseBlock, release.mainIsReleasedMonitor);
    const getUrls = (bullet: string | undefined) =>
      [...(bullet ?? '').matchAll(/https?:\/\/[^)<>"\s]+/g)].map(([url]) => url);

    expect(getUrls(portwingEdgeBullet)).toEqual(['https://github.com/CodesWhat/drydock/pull/852']);
    expect(getUrls(mainMonitorBullet)).toEqual(['https://github.com/CodesWhat/drydock/pull/846']);
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
