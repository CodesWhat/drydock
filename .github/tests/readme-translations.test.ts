import { readFileSync } from 'node:fs';
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
    builtWithHeading: '### Gebaut mit',
    communityQaHeading: '### Community-QA',
    releaseHeading: '<summary><strong>Highlights von v1.7.0-rc.1</strong></summary>',
  },
  'README.es.md': {
    featureTableHeader: '| | Característica | Descripción |',
    builtWithHeading: '### Construido con',
    communityQaHeading: '### Control de calidad de la comunidad',
    releaseHeading: '<summary><strong>Aspectos destacados de v1.7.0-rc.1</strong></summary>',
  },
  'README.fr.md': {
    featureTableHeader: '| | Fonctionnalité | Descriptif |',
    builtWithHeading: '### Construit avec',
    communityQaHeading: '### Contrôle qualité de la communauté',
    releaseHeading: '<summary><strong>Points forts de la v1.7.0-rc.1</strong></summary>',
  },
  'README.pl.md': {
    featureTableHeader: '| | Funkcja | Opis |',
    builtWithHeading: '### Zbudowany z',
    communityQaHeading: '### Kontrola jakości społeczności',
    releaseHeading:
      '<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.1</strong></summary>',
  },
  'README.pt-BR.md': {
    featureTableHeader: '| | Recurso | Descrição |',
    builtWithHeading: '### Construído com',
    communityQaHeading: '### Controle de qualidade da comunidade',
    releaseHeading: '<summary><strong>Destaques da v1.7.0-rc.1</strong></summary>',
  },
  'README.zh-CN.md': {
    featureTableHeader: '| |特色|描述 |',
    builtWithHeading: '### 技术栈',
    communityQaHeading: '### 社区质量检查',
    releaseHeading: '<summary><strong>v1.7.0-rc.1 亮点</strong></summary>',
  },
};

const localizedReleaseFragments: Record<
  string,
  { dependencyAware: string; securityHardening: string }
> = {
  'README.de.md': {
    dependencyAware: '**Abhängigkeitsbewusste Updates**',
    securityHardening: '**Sicherheits- und Lifecycle-Härtung**',
  },
  'README.es.md': {
    dependencyAware: '**Actualizaciones conscientes de dependencias**',
    securityHardening: '**Refuerzo de seguridad y ciclo de vida**',
  },
  'README.fr.md': {
    dependencyAware: '**Mises à jour tenant compte des dépendances**',
    securityHardening: '**Renforcement de la sécurité et du cycle de vie**',
  },
  'README.pl.md': {
    dependencyAware: '**Aktualizacje uwzględniające zależności**',
    securityHardening: '**Wzmocnienie bezpieczeństwa i cyklu życia**',
  },
  'README.pt-BR.md': {
    dependencyAware: '**Atualizações com reconhecimento de dependências**',
    securityHardening: '**Reforço de segurança e ciclo de vida**',
  },
  'README.zh-CN.md': {
    dependencyAware: '**依赖感知更新**',
    securityHardening: '**安全与生命周期强化**',
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
  'version-1.7.0--rc.1-blue',
  'https://www.bestpractices.dev/projects/11915',
  '`drydock.sid`',
  '`allowmetadata=true`',
  '`DD_NOTIFICATION_HTTP_*`',
  'DEPRECATIONS.md#enforced-security-changes-no-deprecation-window',
  'v1.6.0-rc.13',
  'v1.6.0-rc.12',
  'v1.6.0-rc.11',
  './CHANGELOG.md#160--2026-08-11',
  './CHANGELOG.md#170-rc1--2026-08-13',
  'Portwing 0.9.0+',
  'Standard HTTP',
  '`DD_EXPERIMENTAL_PORTWING=false`',
  '2027',
  '[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)',
  '[`GOVERNANCE.md`](GOVERNANCE.md)',
  '[`SECURITY-ASSURANCE.md`](SECURITY-ASSURANCE.md)',
  '[`SECURITY.md`](SECURITY.md)',
  'https://github.com/CodesWhat/drydock/stargazers',
  'https://getdrydock.com/api/star-history?theme=dark',
  'https://getdrydock.com/api/star-history?theme=light',
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
    expect(content).not.toContain('version-1.6.0--rc.2-blue');
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
    const dependencyBullet = getBullet(releaseBlock, release.dependencyAware);
    const securityBullet = getBullet(releaseBlock, release.securityHardening);

    expect(dependencyBullet).toContain('https://github.com/CodesWhat/drydock/discussions/219');
    expect(dependencyBullet).not.toContain('https://github.com/CodesWhat/drydock/issues/708');
    expect(securityBullet).toContain('https://github.com/CodesWhat/drydock/issues/708');
    expect(securityBullet).not.toContain('https://github.com/CodesWhat/drydock/discussions/219');
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

  test('uses only the canonical first-party tracker', () => {
    expect(content).toContain('https://getdrydock.com/api/star-history?theme=dark');
    expect(content).toContain('https://getdrydock.com/api/star-history?theme=light');
    expect(content).not.toContain('api.star-history.com');
    expect(content).not.toContain('star-history.com/#');
  });
});

describe.each(allReadmes)('%s markup', (readme) => {
  const content = readFileSync(`${repoRoot}/${readme}`, 'utf8');

  test.each(balancedTagPairs)('balances $name tags', ({ opening, closing }) => {
    expect(content.match(opening)).toHaveLength(content.match(closing)?.length ?? 0);
  });
});
