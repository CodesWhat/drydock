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
    releaseHeading: '<summary><strong>Highlights von v1.7.0-rc.12</strong></summary>',
  },
  'README.es.md': {
    featureTableHeader: '| | Característica | Descripción |',
    builtWithHeading: '<h2 align="center" id="built-with">Construido con</h2>',
    communityQaHeading: '### Control de calidad de la comunidad',
    releaseHeading: '<summary><strong>Aspectos destacados de v1.7.0-rc.12</strong></summary>',
  },
  'README.fr.md': {
    featureTableHeader: '| | Fonctionnalité | Descriptif |',
    builtWithHeading: '<h2 align="center" id="built-with">Construit avec</h2>',
    communityQaHeading: '### Contrôle qualité de la communauté',
    releaseHeading: '<summary><strong>Points forts de la v1.7.0-rc.12</strong></summary>',
  },
  'README.pl.md': {
    featureTableHeader: '| | Funkcja | Opis |',
    builtWithHeading: '<h2 align="center" id="built-with">Zbudowany z</h2>',
    communityQaHeading: '### Kontrola jakości społeczności',
    releaseHeading:
      '<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.12</strong></summary>',
  },
  'README.pt-BR.md': {
    featureTableHeader: '| | Recurso | Descrição |',
    builtWithHeading: '<h2 align="center" id="built-with">Construído com</h2>',
    communityQaHeading: '### Controle de qualidade da comunidade',
    releaseHeading: '<summary><strong>Destaques da v1.7.0-rc.12</strong></summary>',
  },
  'README.zh-CN.md': {
    featureTableHeader: '| |特色|描述 |',
    builtWithHeading: '<h2 align="center" id="built-with">技术栈</h2>',
    communityQaHeading: '### 社区质量检查',
    releaseHeading: '<summary><strong>v1.7.0-rc.12 亮点</strong></summary>',
  },
};

const localizedReleaseFragments: Record<
  string,
  {
    coopHeader: string;
    embedderHeader: string;
    archDigestProbe: string;
    sessionStoreSplit: string;
    sessionsCollectionMention: string;
    agentsTlsMismatch: string;
  }
> = {
  'README.de.md': {
    coopHeader:
      '**Die Demo-Site sendete kein `Cross-Origin-Opener-Policy`, sodass der wöchentliche DAST-Scan bei jeder Ausführung an ZAP-Regel 90004 scheiterte.**',
    embedderHeader: 'bereits vorhandenen `Cross-Origin-Embedder-Policy`-Header',
    archDigestProbe:
      '**Der arm64-Durchlauf der Image-Arch-Prüfung im Release schlug bei jedem Multi-Plattform-Cut mit `docker: cannot overwrite digest` fehl.**',
    sessionStoreSplit:
      '**DR-121: Der Session-Store und der Haupt-Store schrieben dieselbe `/store/dd.json`, und wer zuletzt speicherte, löschte die Daten des anderen.**',
    sessionsCollectionMention: 'verwirft eine veraltete `Sessions`-Collection',
    agentsTlsMismatch:
      '**Das gepaarte Gitea-Registry-Beispiel der Agents-Seite ließ den Controller HTTPS mit einem Agent sprechen, der nur HTTP anbot.**',
  },
  'README.es.md': {
    coopHeader:
      '**El sitio de demostración no enviaba `Cross-Origin-Opener-Policy`, por lo que el escaneo DAST semanal fallaba en la regla 90004 de ZAP en cada ejecución.**',
    embedderHeader: 'cabecera `Cross-Origin-Embedder-Policy` ya existente',
    archDigestProbe:
      '**El paso arm64 de la comprobación de arquitectura de imagen del release fallaba en cada corte multiplataforma con `docker: cannot overwrite digest`.**',
    sessionStoreSplit:
      '**DR-121: el almacén de sesiones y el almacén principal escribían el mismo `/store/dd.json`, y el que guardaba último borraba los datos del otro.**',
    sessionsCollectionMention: 'descarta una colección `Sessions` obsoleta',
    agentsTlsMismatch:
      '**El ejemplo emparejado de registry de Gitea de la página de agentes hacía que el controlador hablara HTTPS con un agente que servía HTTP simple.**',
  },
  'README.fr.md': {
    coopHeader:
      "**Le site de démonstration n'envoyait pas `Cross-Origin-Opener-Policy`, si bien que le scan DAST hebdomadaire échouait sur la règle ZAP 90004 à chaque exécution.**",
    embedderHeader: "l'en-tête `Cross-Origin-Embedder-Policy` déjà présent",
    archDigestProbe:
      "**Le passage arm64 du contrôle d'architecture d'image du release échouait à chaque coupe multiplateforme avec `docker: cannot overwrite digest`.**",
    sessionStoreSplit:
      "**DR-121 : le magasin de sessions et le magasin principal écrivaient dans le même `/store/dd.json`, et celui qui enregistrait en dernier effaçait les données de l'autre.**",
    sessionsCollectionMention: 'abandonne une collection `Sessions` obsolète',
    agentsTlsMismatch:
      "**L'exemple apparié de registre Gitea de la page des agents faisait parler HTTPS au contrôleur avec un agent servant du HTTP simple.**",
  },
  'README.pl.md': {
    coopHeader:
      '**Strona demo nie wysyłała `Cross-Origin-Opener-Policy`, przez co cotygodniowy skan DAST za każdym razem zawodził na regule ZAP 90004.**',
    embedderHeader: 'istniejącego już nagłówka `Cross-Origin-Embedder-Policy`',
    archDigestProbe:
      '**Przebieg arm64 kontroli architektury obrazu wydania kończył się niepowodzeniem przy każdym wieloplatformowym cięciu z `docker: cannot overwrite digest`.**',
    sessionStoreSplit:
      '**DR-121: magazyn sesji i magazyn główny zapisywały ten sam plik `/store/dd.json`, a ten, który zapisał jako ostatni, kasował dane drugiego.**',
    sessionsCollectionMention: 'odrzuca przestarzałą kolekcję `Sessions`',
    agentsTlsMismatch:
      '**Sparowany przykład rejestru Gitea na stronie agentów sprawiał, że kontroler mówił po HTTPS do agenta obsługującego zwykłe HTTP.**',
  },
  'README.pt-BR.md': {
    coopHeader:
      '**O site de demonstração não enviava `Cross-Origin-Opener-Policy`, então a varredura DAST semanal falhava na regra 90004 do ZAP em toda execução.**',
    embedderHeader: 'cabeçalho `Cross-Origin-Embedder-Policy` já existente',
    archDigestProbe:
      '**A etapa arm64 da verificação de arquitetura de imagem do release falhava em todo corte multiplataforma com `docker: cannot overwrite digest`.**',
    sessionStoreSplit:
      '**DR-121: o armazenamento de sessões e o armazenamento principal escreviam no mesmo `/store/dd.json`, e quem salvasse por último apagava os dados do outro.**',
    sessionsCollectionMention: 'descarta uma coleção `Sessions` obsoleta',
    agentsTlsMismatch:
      '**O exemplo pareado de registry do Gitea na página de agentes fazia o controlador falar HTTPS com um agente servindo HTTP simples.**',
  },
  'README.zh-CN.md': {
    coopHeader:
      '**演示站点此前没有发送 `Cross-Origin-Opener-Policy`，导致每周的 DAST 扫描每次都在 ZAP 规则 90004 上失败。**',
    embedderHeader: '已有的 `Cross-Origin-Embedder-Policy` 头',
    archDigestProbe:
      '**发布流程中镜像架构检查的 arm64 环节在每次多平台构建中都会因 `docker: cannot overwrite digest` 而失败。**',
    sessionStoreSplit:
      '**DR-121：会话存储和主存储此前写入同一个 `/store/dd.json`，谁最后保存就会抹掉另一方的数据。**',
    sessionsCollectionMention: '丢弃旧版本遗留下来的过期 `Sessions` 集合',
    agentsTlsMismatch:
      '**代理页面配对的 Gitea registry 示例让控制器以 HTTPS 与只提供纯 HTTP 的代理通信。**',
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
  './CHANGELOG.md#170-rc4--2026-08-26',
  './CHANGELOG.md#170-rc5--2026-08-27',
  './CHANGELOG.md#170-rc6--2026-08-29',
  './CHANGELOG.md#170-rc7--2026-08-29',
  './CHANGELOG.md#170-rc8--2026-09-03',
  './CHANGELOG.md#170-rc9--2026-09-03',
  './CHANGELOG.md#170-rc10--2026-09-04',
  './CHANGELOG.md#170-rc11--2026-09-05',
  './CHANGELOG.md#170-rc12--2026-09-06',
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
    const releaseBullets = [
      release.coopHeader,
      release.archDigestProbe,
      release.sessionStoreSplit,
      release.agentsTlsMismatch,
    ].map((fragment) => getBullet(releaseBlock, fragment));
    const getUrls = (bullet: string | undefined) =>
      [...(bullet ?? '').matchAll(/https?:\/\/[^)<>"\s]+/g)].map(([url]) => url);

    expect(releaseBullets.every(Boolean)).toBe(true);
    expect(releaseBullets[0]).toContain(release.embedderHeader);
    expect(releaseBullets[2]).toContain(release.sessionsCollectionMention);
    expect(releaseBullets.flatMap(getUrls).sort()).toEqual([
      'https://github.com/CodesWhat/drydock/pull/1042',
      'https://github.com/CodesWhat/drydock/pull/1046',
      'https://github.com/CodesWhat/drydock/pull/1050',
      'https://github.com/CodesWhat/drydock/pull/1063',
    ]);
    expect(getUrls(releaseBullets[0]).sort()).toEqual([
      'https://github.com/CodesWhat/drydock/pull/1050',
    ]);
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

test('English rc.7 update highlight scopes cleanup failures to the health gate', () => {
  const releaseBlock = getReleaseBlock(
    sourceReadme,
    '<summary><strong>v1.7.0-rc.7 highlights</strong></summary>',
  );
  const bullet = getBullet(releaseBlock, '**Update execution stays successful');
  const urls = [...(bullet ?? '').matchAll(/https?:\/\/[^)<>"]+/g)].map(([url]) => url);

  expect(bullet).toContain('after the health gate');
  expect(bullet).toContain('self-updates wait for active lifecycles');
  expect(urls.sort()).toEqual([
    'https://github.com/CodesWhat/drydock/pull/931',
    'https://github.com/CodesWhat/drydock/pull/942',
  ]);
});

test('German rc.7 release notes use registry terminology', () => {
  const german = readFileSync(`${repoRoot}/README.de.md`, 'utf8');

  expect(german).not.toContain('Registrierungspaginierung');
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
