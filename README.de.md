<div align="center">

<p><a href="README.md">English</a> · <a href="README.es.md">Español</a> · <a href="README.pl.md">Polski</a> · <a href="README.zh-CN.md">简体中文</a> · <strong>Deutsch</strong> · <a href="README.fr.md">Français</a> · <a href="README.pt-BR.md">Português (Brasil)</a></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/whale-logo-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/whale-logo.png" />
  <img src="docs/assets/whale-logo.png" alt="drydock" width="220">
</picture>

<h1>drydock</h1>

**Container-Image-Update-Watcher – 23 Register, 20 Benachrichtigungs- und Aktionsanbieter.**

</div>

<p align="center"><a href="https://github.com/CodesWhat/drydock/releases"><img src="https://img.shields.io/github/v/release/CodesWhat/drydock?include_prereleases&label=release" alt="Release"></a>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-informational?logo=linux&logoColor=white" alt="Multi-arch"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/CodesWhat/drydock" alt="License"></a>
  <br>
  <a href="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml"><img src="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/CodesWhat/drydock"><img src="https://img.shields.io/ossf-scorecard/github.com/CodesWhat/drydock?label=openssf+scorecard&style=flat" alt="OpenSSF Scorecard"></a>
  <a href="https://www.bestpractices.dev/projects/11915"><img src="https://www.bestpractices.dev/projects/11915/badge" alt="OpenSSF Best Practices"></a>
  <a href="https://qlty.sh/gh/CodesWhat/projects/drydock"><img src="https://qlty.sh/gh/CodesWhat/projects/drydock/maintainability.svg" alt="Maintainability"></a>
  <a href="https://dashboard.stryker-mutator.io/reports/github.com/CodesWhat/drydock/main"><img src="https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2FCodesWhat%2Fdrydock%2Fmain" alt="Mutation testing"></a>
  <a href="https://codecov.io/gh/CodesWhat/drydock"><img src="https://codecov.io/gh/CodesWhat/drydock/graph/badge.svg" alt="Coverage"></a>
  <br>
  <a href="https://hub.docker.com/r/codeswhat/drydock"><img src="https://img.shields.io/docker/pulls/codeswhat/drydock?logo=docker&logoColor=white&label=Docker+Hub" alt="Docker Hub pulls"></a>
  <a href="https://github.com/CodesWhat/drydock/stargazers"><img src="https://img.shields.io/github/stars/CodesWhat/drydock?style=flat" alt="Stars"></a>
  <a href="https://github.com/veggiemonk/awesome-docker#container-management"><img src="https://awesome.re/mentioned-badge.svg" alt="Mentioned in Awesome Docker"></a>
  <a href="https://crowdin.com/project/drydock"><img src="https://badges.crowdin.net/drydock/localized.svg" alt="Crowdin localization"></a>
  <a href="https://github.com/sponsors/CodesWhat"><img src="https://img.shields.io/badge/Sponsor-ea4aaa?logo=githubsponsors&logoColor=white" alt="Sponsor"></a>
</p>

<hr>

> [!WARNING]
> **Aktualisierung von einer älteren Version? Lesen Sie zuerst die Upgrade-Hinweise.** Drei Korrekturen zur Sicherheitsverstärkung wurden erstmals in **1.4.6** ausgeliefert und durchlaufen die gesamte **1.5**-Reihe, sodass jeder, der von einer Version älter als 1.4.6 aktualisiert, davon betroffen ist, unabhängig davon, auf welcher Version er landet (1.4.6, jede 1.5.x oder höher). Sie sind keine veralteten Versionen und haben keine Kulanzfrist: OIDC erfordert jetzt `authorization_endpoint` in den Erkennungsmetadaten Ihres Anbieters, nicht authentifizierte ratenbegrenzende Schlüssel auf der TCP-Peer-Adresse (gemeinsamer Bucket hinter einem Reverse-Proxy) und HTTP-Trigger-Proxy-URLs müssen `http(s)://` verwenden. Lesen Sie vor der Aktualisierung **[UPGRADE-NOTES.md](UPGRADE-NOTES.md)**.

<!-- separate alerts: a blank-line-only gap between blockquotes trips markdownlint MD028 -->

> [!WARNING]
> **Aktualisierung auf 1.6.0-rc.3 oder neuer?** Weitere Sicherheitsverschärfungen gelten ohne Übergangsfrist. Eine Instanz ohne konfigurierte Authentifizierung oder mit aktivierter, aber unbestätigter anonymer Authentifizierung schlägt beim Upgrade jetzt genauso geschlossen fehl wie eine Neuinstallation: Der Container läuft, geschützte API-Anfragen geben `401` zurück, öffentliche Routen für Authentifizierungserkennung und -status bleiben erreichbar und `/health` gibt `503` zurück. Die SPA-Shell kann weiterhin laden, aber keine geschützten Anwendungsdaten lesen. Setzen Sie vor dem Upgrade `DD_ANONYMOUS_AUTH_CONFIRM=true` oder konfigurieren Sie `DD_AUTH_BASIC_*`/OIDC. Das Sitzungscookie wird von `connect.sid` in `drydock.sid` umbenannt, wodurch alle bestehenden Benutzer einmalig abgemeldet werden. HTTP-Benachrichtigungstrigger sowie der Hass-Webhook und Registry-Icon-Abrufe lösen Hostnamen jetzt über eine geschützte DNS-Suche auf, die Cloud-Metadaten- und Link-Local-Ziele blockiert und Weiterleitungen nie folgt. Setzen Sie `allowmetadata=true` nur für einen bestimmten `DD_NOTIFICATION_HTTP_*`-Trigger, wenn dies wirklich erforderlich ist. Vollständige Migrationshinweise finden Sie in **[DEPRECATIONS.md](DEPRECATIONS.md#enforced-security-changes-no-deprecation-window)**.

<h2 align="center">Inhalt</h2>

- [Dokumentation](#documentation)
- [Schnellstart](#quick-start)
- [Aktuelle Updates](#recent-updates)
- [Screenshots & Live-Demo](#screenshots)
- [Warum Drydock](#why-drydock)
- [Eigenschaften](#features)
- [Unterstützte Integrationen](#supported-integrations)
- [Funktionsvergleich](#feature-comparison)
- [Migration](#migration)
- [Roadmap](#roadmap)
- [Sterngeschichte](#star-history)
- [Gebaut mit](#built-with)
- [Gemeinschaft & Support](#community-support)
- [CodesWhat-Ökosystem](#codeswhat-ecosystem)

<h2 align="center" id="documentation">Dokumentation</h2>

| Ressource             | Link                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Website               | [getdrydock.com](https://getdrydock.com/)                                                       |
| Live-Demo             | [demo.getdrydock.com](https://demo.getdrydock.com)                              |
| Dokumente             | [getdrydock.com/docs](https://getdrydock.com/docs)                                              |
| Konfiguration         | [Konfiguration](https://getdrydock.com/docs/configuration)                                                      |
| Schnellstart          | [Schnellstart](https://getdrydock.com/docs/quickstart)                                                          |
| Änderungsprotokoll    | [`CHANGELOG.md`](CHANGELOG.md)                                                                                  |
| Deprecations          | [`DEPRECATIONS.md`](DEPRECATIONS.md)                                                                            |
| Roadmap               | Siehe den Abschnitt [„Roadmap“](#roadmap) unten                                                                  |
| Mitwirken             | [`CONTRIBUTING.md`](CONTRIBUTING.md)                                                                            |
| Code of Conduct       | [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)                                                                      |
| Governance            | [`GOVERNANCE.md`](GOVERNANCE.md)                                                                                |
| Sicherheitsnachweis   | [`SECURITY-ASSURANCE.md`](SECURITY-ASSURANCE.md)                                                                |
| Sicherheitsrichtlinie | [`SECURITY.md`](SECURITY.md)                                                                                    |
| Probleme              | [GitHub Issues](https://github.com/CodesWhat/drydock/issues)                                                    |
| Diskussionen          | [GitHub Discussions](https://github.com/CodesWhat/drydock/discussions) – Funktionsanfragen und Ideen willkommen |

<hr>

<h2 align="center" id="quick-start">Schnellstart</h2>

**Empfohlen: Verwenden Sie einen Socket-Proxy**, um einzuschränken, auf welche Docker-API-Endpunkte Drydock zugreifen kann. Dadurch wird vermieden, dass der Container vollen Zugriff auf den Docker-Socket erhält.

> **Hinweis:** Compose behandelt `$` als Variableninterpolationssyntax, sodass ein argon2id-Hash mit einfachem `$` beschädigt bei Drydock ankommt. Verdoppeln Sie beim Einfügen des echten Hashes jedes `$` zu `$$`, zum Beispiel `$$argon2id$$v=19$$m=65536,t=3,p=4$$salt$$hash`.

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      socket-proxy:
        condition: service_healthy
    volumes:
      - drydock-store:/store
    environment:
      - DD_WATCHER_LOCAL_HOST=socket-proxy
      - DD_WATCHER_LOCAL_PORT=2375
      - DD_AUTH_BASIC_ADMIN_USER=admin
      - "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>"
    ports:
      - 3000:3000

  socket-proxy:
    image: tecnativa/docker-socket-proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - CONTAINERS=1
      - IMAGES=1
      - EVENTS=1
      - SERVICES=1
      - INFO=1          # Required for daemon identity detection (notification prefixes)
      # Add POST=1 and NETWORKS=1 for container actions and auto-updates
    healthcheck:
      test: wget --spider http://localhost:2375/version || exit 1
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 5s
    restart: unless-stopped

volumes:
  drydock-store:
```

<details>
<summary>Alternativ: <a href="https://github.com/CodesWhat/sockguard">sockguard</a> Socket-Proxy</summary>

[sockguard](https://github.com/CodesWhat/sockguard) ist ein standardmäßig verweigernder Docker-Socket-Filter aus demselben CodesWhat-Ökosystem mit einer für drydock erstellten Voreinstellung:

> **Hinweis:** Compose behandelt `$` als Variableninterpolationssyntax, sodass ein argon2id-Hash mit einfachem `$` beschädigt bei Drydock ankommt. Verdoppeln Sie beim Einfügen des echten Hashes jedes `$` zu `$$`, zum Beispiel `$$argon2id$$v=19$$m=65536,t=3,p=4$$salt$$hash`.

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      sockguard:
        condition: service_healthy
    volumes:
      - drydock-store:/store
    environment:
      - DD_WATCHER_LOCAL_HOST=sockguard
      - DD_WATCHER_LOCAL_PORT=2375
      - DD_AUTH_BASIC_ADMIN_USER=admin
      - "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>"
    ports:
      - 3000:3000

  sockguard:
    image: codeswhat/sockguard
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./sockguard.yaml:/etc/sockguard/config.yaml:ro
    environment:
      - SOCKGUARD_CONFIG_FILE=/etc/sockguard/config.yaml
    healthcheck:
      test: wget --spider http://localhost:2375/version || exit 1
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 5s
    restart: unless-stopped

volumes:
  drydock-store:
```

Siehe sockguards [`app/configs/portwing.yaml`](https://github.com/CodesWhat/sockguard/blob/dev/v1.5/app/configs/portwing.yaml)-Voreinstellung für einen Start-`sockguard.yaml` (die gleiche Voreinstellung portwing wird in eigenen Beispielen geliefert).

</details>

<details>
<summary>Alternative: Schnellstart mit direkter Steckdosenmontage</summary>

```bash
docker run -d \
  --name drydock \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v drydock-store:/store \
  -e DD_AUTH_BASIC_ADMIN_USER=admin \
  -e 'DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>' \
  codeswhat/drydock:latest
```

> **Warnung:** Der direkte Socket-Zugriff gewährt dem Container die volle Kontrolle über den Docker-Daemon. Verwenden Sie das oben beschriebene Socket-Proxy-Setup für Produktionsbereitstellungen. Im [Docker Socket Security Guide](https://getdrydock.com/docs/configuration/watchers#docker-socket-security) finden Sie alle Optionen, einschließlich Remote-TLS und rootless Docker.
>
> Verwenden Sie einfache Anführungszeichen um den Hash-Wert, wie gezeigt. Doppelte Anführungszeichen lassen die Shell weiterhin `$` expandieren, bevor docker es überhaupt sieht, wodurch ein echter argon2id-Hash verstümmelt wird.

</details>

> Generieren Sie einen Passwort-Hash (`argon2` CLI – Installation über Ihren Paketmanager):
>
> ```bash
> echo -n "yourpassword" | argon2 $(openssl rand -base64 32) -id -m 16 -t 3 -p 4 -l 64 -e
> ```
>
> Oder mit Node.js 24.7+ (keine zusätzlichen Pakete erforderlich):
>
> ```bash
> node -e 'const c=require("node:crypto");const s=c.randomBytes(32);const h=c.argon2Sync("argon2id",{message:process.argv[1],nonce:s,memory:65536,passes:3,parallelism:4,tagLength:64});console.log("argon2id$65536$3$4$"+s.toString("base64")+"$"+h.toString("base64"));' "yourpassword"
> ```
>
> Drydock v1.6 akzeptiert nur argon2id Basic-Authentifizierungs-Hashes. Ältere `{SHA}`-, `$apr1$`/`$1$`-, `crypt`- und Klartext-Hashes werden abgelehnt; Regenerieren Sie sie vor dem Upgrade.
> Authentifizierung ist **standardmäßig erforderlich**. Informationen zu OIDC, anonymem Zugriff und anderen Optionen finden Sie in den [auth docs](https://getdrydock.com/docs/configuration/authentications).
> Anonymer Zugriff muss bei neuen und aktualisierten Instanzen gleichermaßen ausdrücklich mit `DD_ANONYMOUS_AUTH_CONFIRM=true` bestätigt werden. Ohne diese Bestätigung startet eine Instanz ohne konfigurierte Authentifizierung oder mit unbestätigter anonymer Authentifizierung geschlossen: Geschützte API-Anfragen geben `401` zurück, öffentliche Routen für Authentifizierungserkennung und -status bleiben verfügbar und `/health` gibt `503` zurück.

Das Image enthält die Binärdateien `trivy` und `cosign` für die lokale Suche nach Schwachstellen und die Image-Verifizierung.

Weitere Informationen zu Docker Compose, Socket-Sicherheit, Reverse-Proxy und alternativen Registrierungen finden Sie im [Quick Start Guide](https://getdrydock.com/docs/quickstart).

<hr>

<h2 align="center" id="recent-updates">Aktuelle Updates</h2>

<details open>
<summary><strong>Highlights von v1.7.0-rc.7</strong></summary>

- **Die Registry-Paginierung folgt jetzt dem Cursor jeder Registry**, damit Prüfungen keine Seiten überspringen oder zu früh enden. ([#927](https://github.com/CodesWhat/drydock/pull/927))
- **Updates bleiben erfolgreich, wenn die Bereinigung nach der Gesundheitsprüfung fehlschlägt**; SSE-Nutzdaten sind kleiner, und Self-Updates warten vor dem exklusiven Gate auf aktive Lebenszyklen. ([#931](https://github.com/CodesWhat/drydock/pull/931), [#942](https://github.com/CodesWhat/drydock/pull/942))
- **Die Anmeldedaten-Redaktion deckt jetzt Trigger, Registries, Debug-Dumps und Lookalike-Hosts ab**, damit Geheimnisse weder protokolliert noch an fremde Registry-Hosts gesendet werden. ([#932](https://github.com/CodesWhat/drydock/pull/932))
- **Compose-Umschreibungen prüfen vor dem Schreiben das Laufzeit-Repository**; Agent-Bereinigung und fehlgeschlagene Rollbacks sind sicher abgedeckt. ([#933](https://github.com/CodesWhat/drydock/pull/933))
- **Header-authentifizierte Anfragen speichern keine Sessions mehr**, sodass Basic-Auth-Polling den Session-Speicher nicht vergrößert. ([#935](https://github.com/CodesWhat/drydock/pull/935))
- **Der Wettbewerbsvergleich und die Roadmap wurden für 2026 aktualisiert**, damit die Release-Dokumentation aktuell bleibt. ([#936](https://github.com/CodesWhat/drydock/pull/936))

Vollständige Release-Notes in [CHANGELOG.md](./CHANGELOG.md#170-rc7--2026-08-29).

</details>

<details open>
<summary><strong>Highlights von v1.7.0-rc.6</strong></summary>

- **Zwei weitere Lücken bei der Container-Eigentümerschaft von Agents werden geschlossen, zusätzlich zum früheren #904-Fix** – eine brandneue Container-ID hatte überhaupt keine Eigentümerschaftsprüfung, sodass ein Agent einen Watcher-Namen beanspruchen konnte, der eigentlich dem Controller gehört; und die Bulk-Ingestion-Pfade (Handshake, der Watcher-Snapshot-Fallback, das On-Demand-`watch`/`watchContainer` und das Edge-`handleContainerSync`) erreichten `processAuthoritativeContainer` ohne jede Prüfung dazwischen, sodass ein Agent bei seinem nächsten routinemäßigen Snapshot weiterhin einen Container beanspruchen konnte, der einem anderen Agent oder dem Controller gehört. Beide Pfade erzwingen jetzt dieselben Eigentümerschaftsprüfungen, die der ursprüngliche Fix eingeführt hat.
- **Registry-Pull-Authentifizierung, Lecks in Fehlerantworten und die Schwärzung in Vorschau-Fehlern werden verschärft** – dreizehn Registries (Hub, Custom, DHI, DOCR, Harbor, Gitea, Forgejo, Codeberg, Nexus, Artifactory, Alibaba CR, OCIR, IBM CR) authentifizierten sich für die Versionsprüfung und zogen dann anonym, weil der Pull-Credential-Builder keinen Zweig für einen konfigurierten `auth`-Wert hatte; er dekodiert diesen Wert jetzt genauso, wie es der Lookup-Credential-Builder bereits tat, und ein fehlerhafter Wert schlägt jetzt geschlossen fehl, statt stillschweigend nichts zurückzugeben. Acht API-Handler interpolieren keine rohe Fehlermeldung mehr – die einen `Authorization`-Header oder eine URL mit eingebetteten Zugangsdaten enthalten könnte – in eine 500er-Antwort, sondern leiten sie jetzt durch den bestehenden `sanitizePreviewErrorReason`-Scrubber, der jetzt auch Zugangsdaten erfasst, die in einem URL-Pfadsegment eingebettet sind (Telegram-, IFTTT- und Discord-Webhook-URLs), nicht nur in Headern oder Userinfo.
- **Die Validierung von Abfrageparametern ist jetzt über die Log-, Agent- und Audit-Endpunkte hinweg konsistent** – ein nicht-numerischer `tail`- oder `since`-Wert landete früher als `NaN` im Ringpuffer-Lesevorgang, statt abgelehnt zu werden, ein leeres `?tail=` wurde als fehlend statt als ungültig gelesen, und ein `limit`/`offset` mit einem numerischen Präfix wie `?limit=25logs` wurde anhand seiner führenden Ziffern validiert statt fehlzuschlagen; alle drei lehnen jetzt alles ab, was keine saubere, ganze Zahl ist.
- **Sechs UI-Fehler werden behoben** – die Zeilenauswahl hob in sieben Ansichten nie wirklich etwas hervor, weil die gemeinsame Datentabelle `selectedKey` deklariert, jede Ansicht ihr aber stattdessen `active-row` übergab; weißer Text mit einem Kontrast von nur 1,37:1 auf dem Trigger-Testbutton und zwei Avataren wird auf ein Token vereinheitlicht, das in allen zwölf Themes 4,5:1 erreicht; das Benachrichtigungs-Postfach und die Vollbild-Detailansicht eines Containers hatten je eine eigene Race-Condition, bei der die Ansicht gerendert wurde, bevor ihre Daten vorlagen, beide sind jetzt abgesichert; zwei Dashboard-Watcher verpassten jede In-Place-SSE-Aktualisierung, weil sie eine einfache Ref statt einer längen- oder fingerprint-bewussten Quelle beobachteten; und Statustext, der an fünf Stellen als rohe englische Enum-Werte gerendert wurde, ist jetzt in allen 16 Sprachen übersetzt.
- **2109 Strings, die noch englischen Quelltext zeigten, sind jetzt tatsächlich übersetzt**, über alle 16 nicht-englischen Sprachen hinweg – große Teile der Containerliste, der Update- und Rollback-Dialoge, der Suchpalette und des Benachrichtigungs-Postfachs waren stillschweigend auf Englisch zurückgefallen, unabhängig von der gewählten Sprache. Der wöchentliche Crowdin-Sync setzt außerdem die sechs übersetzten READMEs nicht mehr auf Englisch zurück: `README.md` ist nicht mehr als Crowdin-Quelle registriert, und die übersetzten READMEs werden jetzt im Repo von Hand gepflegt und bei jedem Release Wort für Wort geprüft. ([#919](https://github.com/CodesWhat/drydock/pull/919))
- **Release- und CI-Zuverlässigkeitsfixes** – der Multi-Architektur-Smoke-Build wiederholt sich jetzt automatisch bei einer offenen BuildKit-Race-Condition (moby/buildkit#7089), die den QEMU-Emulator-Pfad doppelt voranstellen und einen Multi-Arch-Build komplett zum Absturz bringen konnte, und der Release-Cut selbst erhält jetzt einen vollständigen Build-Retry für den Fall, dass der erste Versuch überhaupt keinen Digest erzeugt hat; der wöchentliche DAST-Scan, der nie durchgelaufen ist, weil ZAP allein 39m46s des 40-Minuten-Budgets verbraucht und Nuclei ausgehungert hat, läuft jetzt mit beiden Scannern als separate parallele Jobs; und die Doku-Suche, die zuvor rund 1600 Treffer über fünf archivierte Versionen hinweg lieferte, mit dem ältesten Changelog zuerst, ist jetzt auf die gerade gelesene Version begrenzt.

Vollständige Versionshinweise in [CHANGELOG.md](./CHANGELOG.md#170-rc6--2026-08-29).

</details>

<details>
<summary><strong>Highlights von v1.7.0-rc.5</strong></summary>

- **Ein Security-Hardening-Pass schließt fünf Befunde in Portwing und auf der Debug-/Diagnose-Oberfläche** – eine fehlerhafte Portwing-Hello-Payload wird jetzt vor dem Parsen validiert, statt außerhalb der Callback-Fehlergrenze eine Exception zu werfen; die Container-Eigentümerschaft eines Agents wird jetzt an der Update-/Entfernungsgrenze durchgesetzt; die Schwärzung erfasst jetzt auch `*_PAT`-Werte und in URLs eingebettete Zugangsdaten (einschließlich schema-relativer URLs); und der Pfad für Diagnosen bei abgelehntem Origin ist jetzt ratenbegrenzt. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **Dunkle Themes erfüllen jetzt den WCAG-2.2-Kontrastmindestwert** – sekundärer/gedämpfter Text, die Tonfarben, Toast-Oberflächen und die Beschriftungen der primären Buttons werden angehoben, um in allen sechs dunklen Themes 4,5:1 gegenüber der tatsächlich verwendeten Hintergrundfläche zu erreichen. ([#850](https://github.com/CodesWhat/drydock/issues/850), [#865](https://github.com/CodesWhat/drydock/discussions/865))
- **Große Flotten und langsame Clients bringen die Controller-Verbindung nicht mehr zum Absturz** – ein Agent, dessen zwischengespeicherter Watcher-Replay 256 KiB überschritt, konnte sich nie wieder verbinden; jetzt bleibt der Stream offen, damit der authentifizierte Handshake den Zustand liefert; SSE-Clients, die ins Hintertreffen geraten, erhalten jetzt eine begrenzte, drain-bewusste Zustellung in der richtigen Reihenfolge statt verworfener oder unbegrenzt wachsender Schreibvorgänge; der System-Log-Limiter fällt nicht mehr auf eine leere Identität zurück; und ein nicht unterstützter Agent-Transport wird jetzt schon bei der Aufnahme abgelehnt, statt erst später zu scheitern. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **Der Update- und Watcher-Lebenszyklus bleibt über Neustarts und Abbau hinweg konsistent** – die Startup-Recovery markiert einen unveränderten Container nicht mehr als aktualisiert, ein Neustart unterdrückt keine Batch-Abschlussereignisse mehr für noch laufende Updates, ein Update, das nie gestartet wurde, wird nicht mehr als fehlgeschlagen gemeldet, ein mitten im Setup abgebauter Watcher kann nicht mehr durch einen verspäteten Callback wiederbelebt werden, und gleichzeitig verarbeitete Docker-Event-Chunks laufen nicht mehr in einen gemeinsamen Puffer hinein. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **Korrektheits-Fixes für Backup, Rollback und Container-Listen** – Backups tragen jetzt eine stabile, gescopte Identität, statt bei einem gemeinsam genutzten Containernamen zu kollidieren; ein Rollback stellt jetzt den mit dem Backup gespeicherten Digest wieder her, statt das, worauf ein veränderlicher Tag inzwischen zeigt; gleichzeitige Digest-Scans brechen sich nicht mehr gegenseitig ab; eine erfolgreiche Container-Aktion liefert nicht mehr 500, wenn die anschließende Aktualisierung fehlschlägt; und paginierte Container-Listen werden jetzt global statt nur innerhalb einer Seite sortiert. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **Der Crowdin-Sync-Workflow schlägt bei Nicht-Standard-Dev-Branches nicht mehr fehl** – ein Push auf einen `dev/vX.Y`-Branch, der nicht der neueste war, endete mit einem Checkout-Konflikt, weil der Basis-Resolver unabhängig vom auslösenden Ref immer den höchsten Dev-Branch wählte; ein Push zielt jetzt direkt auf seinen eigenen Branch. ([run 33047712284](https://github.com/CodesWhat/drydock/actions/runs/33047712284))

Vollständige Versionshinweise in [CHANGELOG.md](./CHANGELOG.md#170-rc5--2026-08-27).

</details>

<details>
<summary><strong>Highlights von v1.7.0-rc.4</strong></summary>

- **WebSocket-Log-Streams funktionieren jetzt hinter TLS-terminierenden Proxys** – wenn Trust Proxy aktiviert ist und `X-Forwarded-Proto` beim Upgrade-Request fehlt, fällt die Origin-Prüfung nicht mehr auf den TLS-Status des lokalen Sockets zurück (reines HTTP hinter TLS-Terminierung, wodurch jede Browser-Verbindung mit 403 abgelehnt wurde); das Protokoll gilt jetzt als unbekannt, die Host-Validierung bleibt unverändert. Traefik leitet das clientseitige Schema des Upgrades als `wss` statt als `https` weiter (traefik/traefik#6388), was die Origin-Prüfung rundweg ablehnte, sodass allein der erste Fix hinter einer Standard-Traefik-Konfiguration weiterhin mit 403 fehlschlug; `ws`/`wss` werden jetzt für den Origin-Vergleich auf `http:`/`https:` abgebildet. ([#867](https://github.com/CodesWhat/drydock/issues/867), [#868](https://github.com/CodesWhat/drydock/pull/868), [#887](https://github.com/CodesWhat/drydock/pull/887))
- **Der Start stürzt nicht mehr ab, wenn das Store-Volume `chmod` verweigert** – die in 1.6.0 eingeführte Verschärfung der Berechtigungen warf bei `EPERM` einen Fehler, sodass Mounts, die `chmod` ablehnen (NFS-/CIFS-Volumes, Nicht-Root-Container), den gesamten Prozess beim Start zum Absturz brachten und 1.6.0-Upgrades komplett blockierten; jetzt wird bei `EPERM`/`EACCES`/`ENOTSUP` nur noch eine Warnung ausgegeben und fortgefahren; ein wirklich schreibgeschütztes Volume (`EROFS`) schlägt beim Start weiterhin sofort fehl, weil dort ohnehin nichts gespeichert werden könnte. ([#874](https://github.com/CodesWhat/drydock/discussions/874), [#886](https://github.com/CodesWhat/drydock/pull/886))
- **Debug-Dumps schwärzen jetzt die Werte von Umgebungsvariablen, nicht ihre Namen** – Umgebungsvariablen liegen im Dump als `{key, value}`-Paare vor, und die Schwärzungslogik prüfte bisher den wörtlichen Eigenschaftsnamen `key` gegen ihre Regel für sensible Begriffe, wodurch eine Variable wie `HF_TOKEN` mit geschwärztem Namen, aber im Klartext sichtbarem Wert ausgegeben wurde; Namen bleiben jetzt sichtbar, und Werte werden geschwärzt, wenn der Name einer sensiblen Regel entspricht. ([#875](https://github.com/CodesWhat/drydock/issues/875), [#885](https://github.com/CodesWhat/drydock/pull/885))
- **Reine Ganzzahl-Tags überholen keine gepunkteten Versionen mehr** – ein Build-Zähler-Tag wie `168` wird nicht mehr zu einem fiktiven `168.0.0` aufgewertet, das eine echte Version wie `1.43.3` schlägt; sowohl das vorgeschlagene Tag-Badge als auch der handlungsrelevante `includeTags`-Wiederherstellungspfad teilen sich jetzt eine gemeinsame Partitionierungsregel, damit sie nicht mehr auseinanderdriften können. ([#859](https://github.com/CodesWhat/drydock/issues/859), [#871](https://github.com/CodesWhat/drydock/pull/871))
- **Basis-Images beheben sechs HIGH-OpenSSL-CVEs** – die Digest-Pins von `node:24-alpine` und `alpine:3.24` sowie der `openssl`-apk-Pin werden auf OpenSSL 3.5.8-r0 vorgezogen. ([#881](https://github.com/CodesWhat/drydock/pull/881))
- **Die Demo-Seite sendet jetzt den vollständigen Satz an Sicherheits-Headern** – die von DAST als fehlend markierten Header auf der Demo-Oberfläche werden jetzt gesendet. ([#878](https://github.com/CodesWhat/drydock/pull/878))
- **Container, die den Watch-Bereich verlassen, werden aus Store und UI entfernt** – ein Container, der durch deaktiviertes `watchbydefault` oder durch Entfernen seines `dd.watch`-Labels ausgeschlossen wird, behielt bisher einen veralteten Datensatz, solange er in Docker noch erfolgreich inspiziert werden konnte; gestoppte, aber weiterhin überwachte Container behalten ihr bisheriges Start-Button-Verhalten. ([#869](https://github.com/CodesWhat/drydock/issues/869), [#888](https://github.com/CodesWhat/drydock/pull/888))

Vollständige Versionshinweise in [CHANGELOG.md](./CHANGELOG.md#170-rc4--2026-08-26).

</details>

<details>
<summary><strong>Highlights von v1.7.0-rc.3</strong></summary>

- **Portwing-Edge-Tunnel übertragen jetzt Nicht-JSON-Antworten** – der Willkommens-Frame des Controllers kündigt jetzt die Capability `edge-response-body-b64` an und dekodiert base64-kodierte Docker-Antwortkörper (zum Beispiel die reine Textantwort „OK" von `_ping`) von Agenten, die dies unterstützen; additiv und capability-gated. ([#852](https://github.com/CodesWhat/drydock/pull/852))
- **README-Badges lesen jetzt live** – Version-, Lizenz-, Download- und Sterne-Badges werden jetzt von Live-shields.io-Endpunkten gerendert statt aus statischen Bildern, und das Star-History-Diagramm erscheint jetzt als thematisch passendes Hell/Dunkel-Paar, das beim Release-Cut statt per Cron neu generiert wird. ([#851](https://github.com/CodesWhat/drydock/pull/851), [#844](https://github.com/CodesWhat/drydock/pull/844), [#847](https://github.com/CodesWhat/drydock/pull/847))
- **DAST- und Workflow-Lint-Gates schlagen jetzt hart fehl** – die ZAP-Scans ignorieren nicht mehr jede Warnung, und der Pre-Push-zizmor-Schritt bricht mit einem Installationshinweis ab, statt bei fehlender Binärdatei stillschweigend übersprungen zu werden. ([#842](https://github.com/CodesWhat/drydock/pull/842))
- **Ein täglicher Monitor prüft, dass `main` einen Release-Tag trägt** – ein geplanter, rein lesender Workflow schlägt an, wenn der HEAD von `main` ungetaggt ist. ([#846](https://github.com/CodesWhat/drydock/pull/846))
- **Korrekturen an der Release-Pipeline** – der CI-Bruch des rc.2-Cuts ist behoben: ein fehlerhaftes js-yaml-Override, das Artillery-Lasttests brach, wurde zurückgenommen, und zwei Playwright-Wartezeiten wurden über die eigenen Budgets der App hinaus verlängert. ([#829](https://github.com/CodesWhat/drydock/pull/829), [#836](https://github.com/CodesWhat/drydock/pull/836))

Vollständige Versionshinweise in [CHANGELOG.md](./CHANGELOG.md#170-rc3--2026-08-23).

</details>

<details>
<summary><strong>Highlights von v1.7.0-rc.2</strong></summary>

- **Pro-Container-Richtlinienauflösung für Aktionen** – API und UI zeigen jetzt den aufgelösten Status (blocked/manual/auto) und den entscheidenden Trigger für jeden Container an, plus ein neues Label `dd.action.auto` und der Modus `AUTO=onauto` für reinen manuellen Zugriff ohne automatische Ausführung.
- **Breaking Changes in diesem Zyklus** – `DD_TRIGGER_*`/`dd.trigger.*` sind vollständig entfernt, `trigger-excluded`/`trigger-not-included` werden zu harten Update-Blockern, das MQTT-Themenlayout von Home Assistant erhält standardmäßig ein `agent/<name>`-Segment, `GET /api/auth/methods` liefert jetzt 410, und `curl` ist nicht mehr im Image enthalten.
- **Korrekturen bei der Update-Prüfung** – ein Registry-Fehler während der Prüfung meldet nicht mehr fälschlich „Up to date“, ein fehlerhafter Container leert nicht mehr die gesamte Agenten-Inventarsynchronisierung, und verschachtelte OCI-Image-Indizes werden jetzt korrekt auf das eigentliche Manifest aufgelöst. ([#814](https://github.com/CodesWhat/drydock/issues/814))
- **Abhängigkeits- und Selbst-Update-Korrekturen** – ein abgelehntes Abhängigkeitsmitglied behält seinen Neustart-Kontext, Compose-Aktualisierungen übernehmen keine veralteten, aus dem Image geerbten Umgebungsvariablen mehr, und Update-Richtlinien-Überschreibungen überstehen jetzt das eigene Self-Update von Drydock. ([#718](https://github.com/CodesWhat/drydock/pull/718), [#736](https://github.com/CodesWhat/drydock/pull/736), [#743](https://github.com/CodesWhat/drydock/pull/743))
- **Sicherheit** – ein Pfad für „Remote Property Injection“ in der URL-Abfragesynchronisierung der Container-Liste wurde geschlossen, und das Grype-Image-Gate wurde gezielt um eine CVE eingegrenzt, für die Alpine noch keinen Fix veröffentlicht hat. ([#750](https://github.com/CodesWhat/drydock/pull/750))

Vollständige Versionshinweise in [CHANGELOG.md](./CHANGELOG.md#170-rc2--2026-08-20).

</details>

<details>
<summary><strong>Highlights von v1.7.0-rc.1</strong></summary>

- **Sicherheits- und Lifecycle-Härtung** – Authentifizierung, Agent-Anfragen, Protokolle, WebSockets und Registry-Anfragen sind explizit begrenzt; vertrauliche Befehls- und Hook-Werte werden redigiert; die Home-Assistant-Erkennung synchronisiert sich nach dem Start neu und beendet Provider-Arbeit ohne veraltete Veröffentlichungen. ([#708](https://github.com/CodesWhat/drydock/issues/708))
- **Operator-UX** – installierbare PWA, anklickbare benannte Port-Links, Live-Container-Laufzeit, Tastenkürzel und entprellte Erkennung neu erschienener Container.
- **Breaking-Änderung bei Triggern** – `DD_TRIGGER_*` verhindert jetzt den Start, und die alten Labels `dd.trigger.include` / `dd.trigger.exclude` leiten keine Arbeit mehr weiter. Verwenden Sie `DD_ACTION_*`, `DD_NOTIFICATION_*` und die zugehörigen bereichsspezifischen Labels.
- **Abhängigkeitsbewusste Updates** – Labels oder Compose-Metadaten erzeugen einen validierten Abhängigkeitsgraphen, zeigen die genauen Update-Wellen in der Vorschau und führen Updates oder Neustarts von Abhängigkeiten in deterministischer Reihenfolge aus. Zyklen, Fehler und veraltete Vorschauen werden sicher behandelt. ([Diskussion #219](https://github.com/CodesWhat/drydock/discussions/219))

Vollständige Versionshinweise in [CHANGELOG.md](./CHANGELOG.md#170-rc1--2026-08-14).

</details>

<details>
<summary><strong>Highlights von v1.6.0</strong></summary>

- **Portwing-Edge-/Agent-Transport ist ausgereift** – Controller-gesteuerte native Docker-Prüfungen und -Updates für Portwing 0.9.0+, kontinuierliches Edge-Log-Streaming, Ed25519-Anfragesignierung (v2) und agenteneigene Anzeigenamen, die an den Signaturschlüssel gebunden sind. ([#632](https://github.com/CodesWhat/drydock/issues/632), [#637](https://github.com/CodesWhat/drydock/issues/637))
- **Deklarative Update-Richtlinie mit Reifegrad-Stabilisierung** – dreistufige `dd.updatePolicy.*`-Priorität, ein Live-Countdown bis zur Freigabe eines zurückgehaltenen Kandidaten und eine eigene `maturity-cleared`-Benachrichtigung. ([Diskussion #307](https://github.com/CodesWhat/drydock/discussions/307), [Diskussion #406](https://github.com/CodesWhat/drydock/discussions/406))
- **Benachrichtigungsvorlagen pro Regel, Klingeleinstellungen und ein neues `container-unhealthy`-Ereignis**, dazu bidirektionales Home Assistant MQTT, bei dem die Installieren-Schaltfläche ein echtes Update auslöst. ([Diskussion #205](https://github.com/CodesWhat/drydock/discussions/205), [Diskussion #198](https://github.com/CodesWhat/drydock/discussions/198))
- **Alle wichtigen Listenansichten sind responsiv** – eine gemeinsame `DataTable` mit dauerhaft gespeichertem Tabellen-/Kartenumschalter für alle zehn Listenansichten, die unter etwa 640 px auf Karten umbricht. ([#498](https://github.com/CodesWhat/drydock/issues/498))
- **`/api/v1`-Parität ist vollständig** – der unversionierte Alias `/api/*` und `WS /api/log/stream` wurden entfernt (`410 Gone`); ein optionaler `DD_COMPAT_WUDCARD`-Shim unterstützt wud-card/Homepage. ([Diskussion #469](https://github.com/CodesWhat/drydock/discussions/469))
- **Sicherheitsverschärfung** – anonymer Zugriff schlägt auch bei Upgrades geschlossen fehl, HTTP-Trigger sind gegen SSRF gehärtet, WebSocket-Origin-Prüfungen vergleichen den vollständigen Origin und das Sitzungscookie heißt jetzt `drydock.sid`.

Vollständige Versionshinweise in [CHANGELOG.md](./CHANGELOG.md#160--2026-08-11).

</details>

<details>
<summary><strong>Highlights von v1.6.0-rc.13</strong></summary>

- **Digest-Vergleiche verwenden passende Repository-Kandidaten** – `getOrderedRepoDigests` filtert die `RepoDigests` eines Containers nach dem Repository seiner Image-Referenz, statt einem beliebigen ersten Eintrag zu vertrauen; ein bereits fehlerhafter gespeicherter Anker repariert sich selbst. ([#670](https://github.com/CodesWhat/drydock/pull/670))
- **`nanoid` ist in allen Workspaces auf 3.3.18 fixiert**, um CVE-2026-67213 und im E2E-Workspace CVE-2026-67214 zu beheben. ([#673](https://github.com/CodesWhat/drydock/pull/673))
- **Das Star-History-Diagramm wird selbst gehostet** – eine neue Same-Origin-Route `/api/star-history` ersetzt die Drittanbieter-Einbettung, wird am Edge zwischengespeichert und liefert bei Abruffehlern ein Ersatz-SVG. ([#672](https://github.com/CodesWhat/drydock/pull/672))
- **CVE-Aktualisierung der Basis-Images** – `node:24-alpine` verwendet Node 24.19.0 und die eingebundene `aquasec/trivy`-Build-Stufe 0.73.0, wodurch HIGH/MEDIUM-CVEs in beiden beseitigt werden. ([#682](https://github.com/CodesWhat/drydock/pull/682))
- **Auflösung von Icon-Aliasen** – der Build-Extractor folgt Iconify-Alias-Ketten und enthält die fehlende Font-Awesome-Brands-Sammlung; ein Guard-Test fixiert jedes verwendete Icon im Bundle. ([#683](https://github.com/CodesWhat/drydock/pull/683))

</details>

<details>
<summary><strong>Highlights von v1.6.0-rc.12</strong></summary>

- **Aktualisierte Sicherheitsabhängigkeiten** – `brace-expansion` 5.0.9, `ip-address` 10.3.1 und `fast-uri` 4.1.2 beheben die zugehörigen CVEs. ([#659](https://github.com/CodesWhat/drydock/pull/659))
- **Reifegrad-Uhr** – das Hot/Mature-Badge verwendet wie das Gate zuerst `updatePolicy.maturityMinAgeDays` des Containers und dann den globalen Grenzwert; Fehler beim Ermitteln des Veröffentlichungsdatums werden mit `warn` statt `debug` protokolliert. ([#604](https://github.com/CodesWhat/drydock/issues/604))
- **Kulanz bei Agent-Registrierung** – vorübergehende Blocker `agent-mismatch`/`no-update-trigger-configured` werden auf Anzeigeoberflächen abgeschwächt, während Komponenten neu registriert werden; die Zulassung bleibt geschlossen. ([#605](https://github.com/CodesWhat/drydock/issues/605))
- **WS-Log-Streams und anonyme Authentifizierung** – Log-Stream-WebSocket-Upgrades akzeptieren Sitzungen, wenn anonyme Authentifizierung registriert ist. ([#636](https://github.com/CodesWhat/drydock/issues/636))
- **Explizite 501-Antworten** – Lebenszyklusaktionen auf Agent-Containern ohne Controller-Docker-Transport geben 501 mit Ursache statt eines mehrdeutigen 404 zurück. ([#637](https://github.com/CodesWhat/drydock/issues/637))

</details>

<details>
<summary><strong>Highlights von v1.6.0-rc.11</strong></summary>

- **Portwing-Transport** – Portwing 0.9.0 markiert mit `transport=docker-api`, `execution=controller`, `events=portwing` den nativen Transport für Registry-Prüfungen, Einzel-/Batch-Updates, Lebenszyklusaktionen, Vorschauen und Rollbacks über authentifiziertes Standard HTTP oder Edge. Portwing bleibt Ereignisquelle, und Rohinventar kann Controller-Ergebnisse nicht löschen. ([#632](https://github.com/CodesWhat/drydock/issues/632), [#637](https://github.com/CodesWhat/drydock/issues/637), [Portwing #76](https://github.com/CodesWhat/portwing/issues/76))
- **Benachrichtigungen** – Titel- und Textvorlagen pro Regel/pro Anbieter mit Live-Vorschau sowie prüfungsgestützten In-App-Klingelkategorien und Schwellenwerten für den Aktualisierungsschweregrad.
- **Dashboard** – CSS-Rasterersatz ohne Abhängigkeit mit Maus-/Touch-Neuordnung, begrenzter Größenänderung, responsiven Layouts, Widget-Sichtbarkeit, Zurücksetzen und optionaler geräteübergreifender Präferenzsynchronisierung.
- **Aktualisierungsrichtlinie** – Deklarative Watcher-/Label-/UI-Priorität, Audit-Trail überschreiben/zurücksetzen, Fälligkeits-Countdown/manuelles Überschreiben und Informationssichtbarkeit angehefteter Tags mit einer gestapelten aktuellen → neueren Tag-Ansicht.
- **Container-Ressourcen** – die Ressourcenspalte bleibt standardmäßig sichtbar, kann aber dauerhaft ausgeblendet werden; Quell-, Release-Note- und Registry-Verknüpfungen bleiben im Mehr-Menü und in Kartenfußzeilen verfügbar.
- **Leistung und Wiederherstellung** – Deduplizierung der Tag-Liste pro Umfrage, einfachere Aggregatprojektionen, virtualisierte große Protokollverläufe, unveränderlicher Live-Protokoll-Rollover, Authentifizierungs-Bootstrap-Timeout, vollständige Präferenzmigrationen und Selbstheilung veralteter Chunks.
- **v1.6-Migrationen erzwungen** – WUD-Env-/Label-Aliase, veraltete Authentifizierungsformate, veraltete Watcher-Schalter, Vorlagenaliase, Kafka `clientId` und fehlerhafte öffentliche Hub/DHI-Konfigurationen, die nur auf Tokens basieren, werden nicht mehr ausgeführt. Die Trigger-Taxonomie-Aliase bleiben für eine letzte Warnungsversion auf Fehlerebene bestehen.

Vollständige Migrationsanleitung in [DEPRECATIONS.md](./DEPRECATIONS.md).

</details>

<details>
<summary><strong>v1.5.2 Highlights</strong></summary>

- **Erholungssichere Update-Richtlinie** – Reife-Gates, übersprungene Tags/Digests und Snoozes überleben jetzt die Container-Erstellung für lokale und Remote-Agent-Workloads.
- **Zuverlässigkeit angehefteter Tags** – Vollständig angeheftete Tags erkennen Digest-Neuerstellungen mit demselben Tag erneut, während die Benutzeroberfläche ein nicht umsetzbares neueres Tag derselben Familie anzeigen kann, ohne das Aktualisierungs- oder Auslöseverhalten zu ändern.
- **Rollback-Wiederherstellung** – Bei fehlgeschlagener Ersatzerstellung, Netzwerkanbindung oder Start wird jetzt der Kandidat bereinigt, bevor der ursprüngliche Container wiederhergestellt wird, und wiederholte Fehler können nicht durch verschachtelte Rollback-Umbenennungen kaskadiert werden.
- **Sicherere Containerwiederherstellung** – Vom Daemon zugewiesene MAC-Adressen werden nicht mehr an Ersatzadressen geheftet, während explizit konfigurierte MAC-Adressen des primären Netzwerks erhalten bleiben.
- **Leisere Abfrage lokaler Bilder** – Lokal erstellte oder geladene Bilder ohne Registry-Digest überspringen Remote-Suchen, anstatt wiederkehrende Autorisierungsfehler zu generieren.

Vollständiger Verlauf in [CHANGELOG.md](./CHANGELOG.md).

</details>

<hr>

<h2 align="center" id="screenshots">Screenshots und Live-Demo</h2>

<p align="center">
  <img src="docs/assets/drydock-demo.gif" alt="Drydock detecting and applying a container update" width="880">
</p>

<p align="center"><em>Erkennen Sie ein Update, sehen Sie genau, welche Änderungen sich ergeben, und wenden Sie es an. Sicherung, Gesundheitsprüfung und Rollback werden durchgeführt.</em></p>

<table>
<tbody><tr>
<td width="50%" align="center"><strong>Licht</strong></td>
<td width="50%" align="center"><strong>Dunkel</strong></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-dashboard-light.png" alt="Dashboard Light"></td>
<td><img src="docs/assets/drydock-dashboard-dark.png" alt="Dashboard Dark"></td>
</tr>
</tbody></table>

<div align="center">

**Warum Screenshots anschauen, wenn Sie es selbst erleben können?**

<a href="https://demo.getdrydock.com"><img src="https://img.shields.io/badge/Try_the_Live_Demo-4f46e5?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSI2IDMgMjAgMTIgNiAyMSA2IDMiLz48L3N2Zz4=&logoColor=white" alt="Try the Live Demo" height="36"></a>

Vollständig interaktiv – echte Benutzeroberfläche, Scheindaten, keine Installation erforderlich. Läuft vollständig im Browser.

</div>

<hr>

<h2 align="center" id="why-drydock">Warum Drydock</h2>

Containerbilder veralten stillschweigend. Ein Basisimage patcht ein CVE, eine App schneidet eine Version, ein Tag wird verschoben. Sofern Sie nicht jede Registrierung manuell überwachen, bleiben Ihre laufenden Container zurück, bis etwas kaputt geht oder ausgenutzt wird.

Die meisten Tools erzwingen einen Kompromiss. Die Auto-Updater (Watchtower, Ouroboros) ziehen und starten mit wenig Sichtbarkeit oder Kontrolle neu und werden jetzt weitgehend nicht mehr gewartet. Die Dashboards (Portainer) verwalten Container, sind jedoch nicht für Update-Intelligenz konzipiert. Drydock ist **monitor-first**: Es überwacht 23 Register und teilt Ihnen genau mit, was sich geändert hat (Major, Minor, Patch oder Digest), bevor etwas passiert, und reagiert dann nur, wenn Sie es zulassen. Und es geht weiter als alle anderen. Trivy/Grype Schwachstellenscans blockieren unsichere Updates, Cosign überprüft Signaturen, Image-Backups vor dem Update werden automatisch zurückgesetzt, wenn die Integritätsprüfung fehlschlägt, verteilte Agents decken Remote-Hosts ab und 20 Benachrichtigungs- und Aktionsintegrationen schließen den Kreis. Der vollständige Update-Lebenszyklus mit einer Web-Benutzeroberfläche und einer REST-API.

<hr>

<h2 align="center" id="features">Funktionen</h2>

| | Funktion | Beschreibung |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔭  | **Monitor-First-Erkennung**                    | Überwacht jeden laufenden Container und klassifiziert jedes verfügbare Update als Haupt-, Neben-, Patch- oder Digest-Update, bevor etwas passiert. Es ändert sich nichts, bis Sie es sagen.                                                                                                                                                                                                                                                                                                                                                                   |
| 📦  | **23 Registrierungsanbieter**                  | Docker Hub, GHCR, ECR, ACR, GCR, GAR, GitLab, Quay, Harbour, Artifactory, Nexus und 12 weitere. Öffentlich und privat, in der Cloud und selbst gehostet, mit TLS und Authentifizierung pro Registrierung.                                                                                                                                                                                                                                                                                                                                                     |
| 🔔  | **20 Auslöser**                                | 17 Benachrichtigungskanäle (Slack, Discord, Telegram, Teams, SMTP, MQTT, ntfy und mehr) plus Docker-, Docker Compose- und Command-Aktionen, mit Vorlagen pro Ereignis/Anbieter, Live-Vorschau, Schwellenwertfilterung und Batch-Modus.                                                                                                                                                                                                                                                                                                                     |
| 🥊  | **Update Bouncer**                             | Der Schwachstellenscan Trivy/Grype blockiert unsichere Updates vor der Bereitstellung, mit Cosign-Signaturüberprüfung und SBOM-Generierung (CycloneDX und SPDX).                                                                                                                                                                                                                                                                                                                                                                                           |
| ↩️  | **Image-Sicherung und automatisches Rollback** | Image-Snapshots vor dem Update mit konfigurierbarer Aufbewahrung, automatischem Rollback bei fehlgeschlagener Integritätsprüfung und manuellem Rollback mit einem Klick über die Benutzeroberfläche.                                                                                                                                                                                                                                                                                                                                                                          |
| 🪝  | **Lebenszyklus-Hooks**                         | Shell-Befehle vor und nach dem Update über Container-Labels, mit Zeitüberschreitungen pro Hook und Steuerung des Abbruchs bei Fehler.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 🗂️ | **Docker Compose-Updates**                     | Ziehen Sie Compose-Dienste über die Docker Engine-API mit YAML-erhaltendem Image-Patching ab und erstellen Sie sie neu.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 🎛️ | **Richtlinie pro Container**                   | Regex-Tag-Regeln und Trigger-Routing verwenden `dd.*`-Labels; Reifegrenzen, Skip/Snooze/Pin und Wartungsfenster werden über die Benutzeroberfläche/API oder die Watcher-Konfiguration gespeichert.                                                                                                                                                                                                                                                                                                                                                                            |
| 🛰️ | **Verteilte Agenten**                          | Überwachen Sie Remote-Docker-Hosts über SSE. Portwing 0.9.0+-Agents arbeiten über eingehendes Standard HTTP oder ausgehenden Edge-WebSocket-Transport; Drydock 1.6.0-rc.11+ kann native Registry-Prüfungen und einzelne oder gebündelte Docker-Updates über beide authentifizierten Pfade controllerseitig ausführen. Edge überträgt außerdem fortlaufende Live-Protokolle ohne eingehenden Port; `DD_EXPERIMENTAL_PORTWING=false` bleibt die Notabschaltung. |
| 🖥️ | **Web-Dashboard**                              | Vue 3-Benutzeroberfläche mit einem anpassbaren Widget-Raster ohne Abhängigkeiten, reaktionsfähigen Tabellen-/Kartenansichten, Live-SSE-Updates, Steuerelementen für Benachrichtigungsglocken sowie Details, Protokollen und Statistiken pro Container.                                                                                                                                                                                                                                                                                                                        |
| 🔗  | **REST-API und Webhooks**                      | Token-authentifizierte Endpunkte für CI/CD-Überwachungs- und Update-Trigger sowie signierte Registrierungs-Webhook-Aufnahme für Push-Ereignisse.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 🔐  | **OIDC-Authentifizierung**                     | Sichern Sie das Dashboard mit OpenID Connect (Authelia, Auth0, Authentik). Alle Authentifizierungsabläufe verweigern bei einem Fehler standardmäßig den Zugriff (Fail-Closed).                                                                                                                                                                                                                                                                                                                                                              |
| 📈  | **Prometheus-Metriken**                        | Integrierter `/metrics`-Endpunkt mit optionaler Authentifizierungsumgehung für die Überwachungsstacks Prometheus und Grafana.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 🌍  | **17 UI-Gebietsschemas**                       | Vollständig verkabeltes Übersetzungssystem mit vollständigem Englisch und 16 von der Community gepflegten Gebietsschemas, synchronisiert über Crowdin, umschaltbar in Config.                                                                                                                                                                                                                                                                                                                                                                                                 |
| 🔒  | **ReDoS-Immune Regex**                         | Jedes vom Benutzer bereitgestellte Tag-Muster wird über re2js (einen reinen JS-RE2-Port) für einen linearen Zeitabgleich kompiliert, der nicht durch ein katastrophales Backtracking-Muster blockiert werden kann.                                                                                                                                                                                                                                                                                                                                         |

<hr>

<h2 align="center" id="supported-integrations">Unterstützte Integrationen</h2>

### Register (23)

Docker Hub · GHCR · ECR · ACR · GCR · GAR · GitLab · Quay · LSCR · Harbor · Artifactory · Nexus · Gitea · Forgejo · Codeberg · MAU · TrueForge · Custom · DOCR · DHI · IBM Cloud · Oracle Cloud · Alibaba Cloud

### Aktionen (3)

Docker · Docker Compose · Befehl

### Benachrichtigungen (17)

Apprise · Discord · Google Chat · Gotify · HTTP · IFTTT · Kafka · Matrix · Mattermost · MQTT · MS Teams · NTFY · Pushover · Rocket.Chat · Slack · SMTP · Telegram

### Authentifizierung

Anonym (Opt-in über `DD_ANONYMOUS_AUTH_CONFIRM=true`) · Basic (Benutzername + Passwort-Hash) · OIDC (Authelia, Auth0, Authentik). Alle Authentifizierungsabläufe verweigern bei einem Fehler standardmäßig den Zugriff (Fail-Closed).

### Update Bouncer

Trivy- oder Grype-gestützte Schwachstellenscans blockieren unsichere Updates, bevor sie bereitgestellt werden. Beinhaltet Cosign-Signaturüberprüfung und SBOM-Generierung (CycloneDX & SPDX).

<hr>

<h2 align="center" id="feature-comparison">Funktionsvergleich</h2>

<details>
<summary><strong>Wie schneidet drydock im Vergleich zu anderen Container-Update-Tools ab?</strong></summary>

> ✅ = unterstützt &nbsp; ❌ = nicht unterstützt &nbsp; ⚠️ = teilweise / begrenzt &nbsp; ? = nicht bestätigt &nbsp; † = archiviert, nicht mehr gepflegt

<h4 align="center">Update-Manager</h4>

<table>
<thead>
<tr>
<th width="32%">Funktion</th>
<th width="17%" align="center">drydock</th>
<th width="17%" align="center">WUD</th>
<th width="17%" align="center">Diun</th>
<th width="17%" align="center"><em>Watchtower&nbsp;†</em></th>
</tr>
</thead>
<tbody>
<tr><td>Aktiv gepflegt</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>Weboberfläche / Dashboard</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Automatische Container-Updates</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Docker-Compose-Updates</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td></tr>
<tr><td>SemVer-fähige Updates</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Digest-Überwachung</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Update-Schwellenfilter (Major/Minor/Patch/Digest)</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Abhängigkeitsbewusste Update-Reihenfolge</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Warteschlange für ausstehende Freigaben</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Image-Sicherung und Rollback</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Lifecycle-Hooks (vor/nach)</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Schwachstellen-Scans</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Audit-Protokoll</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>RBAC / Mehrbenutzerrollen</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>OIDC-/SSO-Authentifizierung</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Trigger-/Benachrichtigungskanäle</td><td align="center">20</td><td align="center">17</td><td align="center">17</td><td align="center">~20</td></tr>
<tr><td>MQTT / Home Assistant</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Registry-Anbieter</td><td align="center">23</td><td align="center">12</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>REST-API</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>Webhook-API für CI/CD</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Prometheus-Metriken</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Verteilte Agenten (remote)</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">⚠️</td></tr>
<tr><td>Container-Gruppierung / Stacks</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Container starten/stoppen/neustarten/aktualisieren</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Container-Loganzeige</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
</tbody>
</table>

> Watchtower wurde im Dezember 2025 archiviert; das letzte Release war v1.7.1 (November 2023). Ein inoffizieller Community-Fork, nicholas-fedor/watchtower, wird weiterhin aktiv veröffentlicht.

<h4 align="center">Management-Plattformen</h4>

<table>
<thead>
<tr>
<th width="32%">Funktion</th>
<th width="17%" align="center">drydock</th>
<th width="17%" align="center">Arcane</th>
<th width="17%" align="center">Komodo</th>
<th width="17%" align="center">Dockhand</th>
</tr>
</thead>
<tbody>
<tr><td>Aktiv gepflegt</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Weboberfläche / Dashboard</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Automatische Container-Updates</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Docker-Compose-Updates</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>SemVer-fähige Updates</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Digest-Überwachung</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Update-Schwellenfilter (Major/Minor/Patch/Digest)</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>Abhängigkeitsbewusste Update-Reihenfolge</td><td align="center">⚠️</td><td align="center">✅</td><td align="center">✅</td><td align="center">?</td></tr>
<tr><td>Warteschlange für ausstehende Freigaben</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Image-Sicherung und Rollback</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Schwachstellen-Scans</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Audit-Protokoll</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td></tr>
<tr><td>RBAC / Mehrbenutzerrollen</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td></tr>
<tr><td>OIDC-/SSO-Authentifizierung</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Trigger-/Benachrichtigungskanäle</td><td align="center">20</td><td align="center">11+</td><td align="center">5</td><td align="center">15+</td></tr>
<tr><td>MQTT / Home Assistant</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Registry-Anbieter</td><td align="center">23</td><td align="center">⚠️</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>Prometheus-Metriken</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Verteilte Agenten (remote)</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Container-Gruppierung / Stacks</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">?</td></tr>
</tbody>
</table>

> Zusammengestellt aus der öffentlichen Dokumentation und den Repositories der jeweiligen Projekte, Stand 29.08.2026.
> Beiträge willkommen, wenn Informationen ungenau sind.

</details>

<hr>

<h2 align="center" id="migration">Migration</h2>

<details>
<summary><strong>Migration von WUD (What's Up Docker?)</strong></summary>

Drydock v1.6 lädt zur Laufzeit keine `WUD_*`-Umgebungsvariablen oder `wud.*`-Labels mehr. Schreiben Sie sie neu, bevor Sie den aktualisierten Dienst starten. Der persistente Status wird weiterhin automatisch migriert. Verwenden Sie `docker exec -it drydock node dist/index.js config migrate --dry-run` für die Vorschau und dann `docker exec -it drydock node dist/index.js config migrate --file .env --file compose.yaml`, um die Konfiguration in die Namen `DD_*` und `dd.*` umzuschreiben.

</details>

<hr>

<h2 align="center" id="roadmap">Roadmap</h2>

<details>
<summary><strong>Versionsthemen und Highlights</strong></summary>

Diese Planung deckt mindestens die nächsten zwölf Monate bis August 2027 ab.
Nur übergeordnete Themen; Details pro Version finden Sie in [CHANGELOG.md](CHANGELOG.md).

| Version                                      | Thema                                                        | Höhepunkte                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1.3.x** ✅ | Sicherheit und Stabilität                                    | Trivy-Scanning, Update Bouncer, SBOM, 7 neue Register, 4 neue Trigger, re2js-Regex-Engine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **v1.4.x** ✅ | UI-Modernisierung und -Härtung                               | Tailwind 4 + benutzerdefinierte Komponenten, 6 Themes, Cmd/K-Palette, OpenAPI 3.1, Compose-native YAML-Updates, Dual-Slot-Scanning, OIDC-Härtung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **v1.5.0** ✅ | Beobachtbarkeit & i18n                   | Trigger-Taxonomie-Aufteilung (`DD_ACTION_*`/`DD_NOTIFICATION_*`), WebSocket-Protokollanzeige, Dashboard-Anpassung, Ressourcenüberwachung, Benachrichtigungsausgang + DLQ, Sicherheitsscan-Digest, 17 Gebietsschemas, SSE Last-Event-ID-Wiedergabe, Edge-Agent-Dial-Out mit Ed25519-Authentifizierung (experimentell, `DD_EXPERIMENTAL_PORTWING=true`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **v1.5.1** ✅ | Sicherheit und Wartung                                       | GCR/GAR-Pull-Auth-Fix, Registry-TLS-Vervollständigung (M-2), Hook-Env-Var-Injection-Hardening, `DD_SESSION_SECRET__FILE`-Unterstützung, Debug-Dump-Anmeldeinformationsredaktion, Berechtigungsprüfung für geheime Dateien, Deadlock-Fix für Reifegradtore, vollständige UI-Übersetzbarkeit + Community-Übersetzungen, automatisches Apply-Gate für Wartungsfenster, Container-Verfügbarkeitsanzeige, Tag/Version-Spalten-Split-Surface-Softwareversion (OCI-Label, mit `dd.inspect.tag.path` Dual-Write + Opt-in `dd.inspect.tag.version-only` Routing), Opt-in Compose Mount-Präfix-Matching, `${currentReleaseNotes}` Template Var                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **v1.5.2** ✅ | Zuverlässigkeit von Richtlinien und angehefteten Tags        | Erholungssichere Aufbewahrung von Fälligkeits-/Skip-/Snooze-Richtlinien, Digest-Neuerstellungserkennung mit angehefteten Tags und informative Einblicke in die gleiche Familie, Rollback-Kandidaten-Bereinigung, Rollback-Kaskaden-Verhinderung, explizite MAC-Bewahrung und Verhalten beim Überspringen lokaler Images in der Registrierung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **v1.6.0**   | Benachrichtigungen, Richtlinien und Veröffentlichungen Intel | Benachrichtigungsvorlagen pro Regel/pro Auslöser mit Live-Vorschau, Benachrichtigungsglocken-Einstellungen, geräteübergreifender Präferenzsynchronisierung, benutzerdefiniertem Dashboard-Raster ohne Abhängigkeit ([#281](https://github.com/CodesWhat/drydock/issues/281)), deklarativer Aktualisierungsrichtlinie ([#320](https://github.com/CodesWhat/drydock/issues/320)), Reifegradstabilisierungs-Countdown + sofortiger Kandidatensichtbarkeit + manueller Überschreibung ([#406](https://github.com/CodesWhat/drydock/discussions/406)), umsetzbarem Update-Status-Panel und global `notify` / `manual` / `auto` Aktualisierungsmodus ([#325](https://github.com/CodesWhat/drydock/discussions/325)), Watcher-/imgset-/Container-Tag-Richtlinienvererbung plus gestapelte aktuelle → neuere Sichtbarkeit angehefteter Tags ([#498](https://github.com/CodesWhat/drydock/issues/498)), standardisierte 44px-Quelle/Versionshinweise/Registrierungsressourcenaktionen für Tabelle, Karten und Details ([#295](https://github.com/CodesWhat/drydock/discussions/295)), Ereignisbenachrichtigungen zum Gesundheitsstatus ([#198](https://github.com/CodesWhat/drydock/discussions/198)), bidirektionales Home Assistant MQTT, reaktionsfähige Tabellen-/Kartenlistenansichten, Trivy/Grype/Scannen über Befehl oder angeheftete Docker-Worker-Backends, Scanner-Asset-Pull/Warm-Steuerung, Off-Heap-Deduplizierung SBOM-Speicher, Trivy Long-Scan-Korrektheit ([#490](https://github.com/CodesWhat/drydock/issues/490)), Trigger-Taxonomie-Migrationswarnungen, v1.6-Kompatibilitätsentfernungen, Dokumentation/API-Hygiene und `/api` → `/api/v1`-Migrationsabschluss mit einem optionalen Wud-Card/Homepage-Kompatibilitäts-Shim (`DD_COMPAT_WUDCARD`). |
| **v1.7.0**   | Intelligente Updates und UX                                  | Abhängigkeitsbewusste Reihenfolge ([#219](https://github.com/CodesWhat/drydock/discussions/219)), selektive Massenaktualisierungen ([#232](https://github.com/CodesWhat/drydock/discussions/232)), Aktualisierungsrichtlinie pro Aktion ([#511](https://github.com/CodesWhat/drydock/discussions/511)), Bildbereinigung, statische Bildüberwachung, einheitliche Reife-/Update-Alters-Uhr, anklickbare Port-Links, Tastaturkürzel, PWA, Kontrastüberarbeitung im Dunkelmodus (WCAG 2.2) ([#850](https://github.com/CodesWhat/drydock/issues/850), [#865](https://github.com/CodesWhat/drydock/discussions/865)), Entfernung von `DD_TRIGGER_*` (Ende des Ablauffensters von Version 1.5.0), curl aus dem Image entfernt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **v1.8.0**   | Flottenmanagement und Live-Konfiguration                     | YAML-Konfiguration, Live-UI-Konfiguration, Volume-Browser, parallele Updates, SQLite-Store-Migration, Home Assistant-Updatefortschritt und Geräte pro Container ([#210](https://github.com/CodesWhat/drydock/discussions/210)), lokal erstellte Images, die gegen eine deklarierte Upstream-Basis überwacht werden ([#897](https://github.com/CodesWhat/drydock/discussions/897)), bereichsbezogene rotierbare API-Schlüssel (statische Bearer-Tokens für HA/Dashboard-Integrationen, [#469](https://github.com/CodesWhat/drydock/discussions/469)), Freigabe-Warteschlange pro Update |
| **v2.0+**                    | Plattformerweiterung und darüber hinaus                      | Swarm/Kubernetes-Watcher, GitOps, Health Gates, Canary Deployments, Webterminal, RBAC, LDAP/AD, nativer Podman-Anbieter über die Docker-kompatible API hinaus, CLI, gehärtetes Wolfi-Image, Socket-Proxy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

</details>

<hr>

<h2 align="center" id="star-history">Sterngeschichte</h2>

<div align="center">
  <a href="https://github.com/CodesWhat/drydock/stargazers">
    <img alt="Star History Chart" src="docs/assets/star-history.svg" />
  </a>
</div>

---

<div align="center">

<h2 align="center" id="built-with">Gebaut mit</h2>

[![TypeScript](https://img.shields.io/badge/TypeScript_6.0-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![Vue 3](https://img.shields.io/badge/Vue_3-42b883?logo=vuedotjs&logoColor=fff)](https://vuejs.org/)
[![Express 5](https://img.shields.io/badge/Express_5-000?logo=express&logoColor=fff)](https://expressjs.com/)
[![Vitest](https://img.shields.io/badge/Vitest_4-6E9F18?logo=vitest&logoColor=fff)](https://vitest.dev/)
[![Biome](https://img.shields.io/badge/Biome_2.5-60a5fa?logo=biome&logoColor=fff)](https://biomejs.dev/)
[![Node 24](https://img.shields.io/badge/Node_24_Alpine-339933?logo=nodedotjs&logoColor=fff)](https://nodejs.org/)
[![Anthropic](https://img.shields.io/badge/Anthropic-CC785C?style=flat&logo=anthropic&logoColor=white)](https://claude.ai/)
[![OpenAI](https://img.shields.io/badge/OpenAI-10A37F?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU%2BT3BlbkFJPC90aXRsZT48cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNMjIuMjgxOSA5LjgyMTFhNS45ODQ3IDUuOTg0NyAwIDAgMC0uNTE1Ny00LjkxMDggNi4wNDYyIDYuMDQ2MiAwIDAgMC02LjUwOTgtMi45QTYuMDY1MSA2LjA2NTEgMCAwIDAgNC45ODA3IDQuMTgxOGE1Ljk4NDcgNS45ODQ3IDAgMCAwLTMuOTk3NyAyLjkgNi4wNDYyIDYuMDQ2MiAwIDAgMCAuNzQyNyA3LjA5NjYgNS45OCA1Ljk4IDAgMCAwIC41MTEgNC45MTA3IDYuMDUxIDYuMDUxIDAgMCAwIDYuNTE0NiAyLjkwMDFBNS45ODQ3IDUuOTg0NyAwIDAgMCAxMy4yNTk5IDI0YTYuMDU1NyA2LjA1NTcgMCAwIDAgNS43NzE4LTQuMjA1OCA1Ljk4OTQgNS45ODk0IDAgMCAwIDMuOTk3Ny0yLjkwMDEgNi4wNTU3IDYuMDU1NyAwIDAgMC0uNzQ3NS03LjA3Mjl6bS05LjAyMiAxMi42MDgxYTQuNDc1NSA0LjQ3NTUgMCAwIDEtMi44NzY0LTEuMDQwOGwuMTQxOS0uMDgwNCA0Ljc3ODMtMi43NTgyYS43OTQ4Ljc5NDggMCAwIDAgLjM5MjctLjY4MTN2LTYuNzM2OWwyLjAyIDEuMTY4NmEuMDcxLjA3MSAwIDAgMSAuMDM4LjA1MnY1LjU4MjZhNC41MDQgNC41MDQgMCAwIDEtNC40OTQ1IDQuNDk0NHptLTkuNjYwNy00LjEyNTRhNC40NzA4IDQuNDcwOCAwIDAgMS0uNTM0Ni0zLjAxMzdsLjE0Mi4wODUyIDQuNzgzIDIuNzU4MmEuNzcxMi43NzEyIDAgMCAwIC43ODA2IDBsNS44NDI4LTMuMzY4NXYyLjMzMjRhLjA4MDQuMDgwNCAwIDAgMS0uMDMzMi4wNjE1TDkuNzQgMTkuOTUwMmE0LjQ5OTIgNC40OTkyIDAgMCAxLTYuMTQwOC0xLjY0NjR6TTIuMzQwOCA3Ljg5NTZhNC40ODUgNC40ODUgMCAwIDEgMi4zNjU1LTEuOTcyOFYxMS42YS43NjY0Ljc2NjQgMCAwIDAgLjM4NzkuNjc2NWw1LjgxNDQgMy4zNTQzLTIuMDIwMSAxLjE2ODVhLjA3NTcuMDc1NyAwIDAgMS0uMDcxIDBsLTQuODMwMy0yLjc4NjVBNC41MDQgNC41MDQgMCAwIDEgMi4zNDA4IDcuODcyem0xNi41OTYzIDMuODU1OEwxMy4xMDM4IDguMzY0IDE1LjExOTIgNy4yYS4wNzU3LjA3NTcgMCAwIDEgLjA3MSAwbDQuODMwMyAyLjc5MTNhNC40OTQ0IDQuNDk0NCAwIDAgMS0uNjc2NSA4LjEwNDJ2LTUuNjc3MmEuNzkuNzkgMCAwIDAtLjQwNy0uNjY3em0yLjAxMDctMy4wMjMxbC0uMTQyLS4wODUyLTQuNzczNS0yLjc4MThhLjc3NTkuNzc1OSAwIDAgMC0uNzg1NCAwTDkuNDA5IDkuMjI5N1Y2Ljg5NzRhLjA2NjIuMDY2MiAwIDAgMSAuMDI4NC0uMDYxNWw0LjgzMDMtMi43ODY2YTQuNDk5MiA0LjQ5OTIgMCAwIDEgNi42ODAyIDQuNjZ6TTguMzA2NSAxMi44NjNsLTIuMDItMS4xNjM4YS4wODA0LjA4MDQgMCAwIDEtLjAzOC0uMDU2N1Y2LjA3NDJhNC40OTkyIDQuNDk5MiAwIDAgMSA3LjM3NTctMy40NTM3bC0uMTQyLjA4MDVMOC43MDQgNS40NTlhLjc5NDguNzk0OCAwIDAgMC0uMzkyNy42ODEzem0xLjA5NzYtMi4zNjU0bDIuNjAyLTEuNDk5OCAyLjYwNjkgMS40OTk4djIuOTk5NGwtMi41OTc0IDEuNDk5Ny0yLjYwNjctMS40OTk3WiIvPjwvc3ZnPg%3D%3D)](https://openai.com)

[![SemVer](https://img.shields.io/badge/semver-2.0.0-blue)](https://semver.org/)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=fff)](https://www.conventionalcommits.org/)
[![Keep a Changelog](https://img.shields.io/badge/changelog-Keep%20a%20Changelog-E05735)](https://keepachangelog.com/)

<h2 align="center" id="community-support">Gemeinschaft & Support</h2>

Echtzeit-Chat und frühzeitige Unterstützung: **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**

Fehler und konkrete Funktionsanfragen gehören zu **[GitHub Issues](https://github.com/CodesWhat/drydock/issues)**; offene Fragen, Ideen und Showcases gehören zu **[GitHub Discussions](https://github.com/CodesWhat/drydock/discussions)**; Echtzeit-Chat findet im **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)** statt.

### Community-QA

Vielen Dank an die Benutzer, die beim Testen der Release-Kandidaten v1.4.0 und v1.5.0 geholfen und Fehler gemeldet haben:

[@RK62](https://github.com/RK62) &middot; [@flederohr](https://github.com/flederohr) &middot; [@rj10rd](https://github.com/rj10rd) &middot; [@larueli](https://github.com/larueli) &middot; [@Waler](https://github.com/Waler) &middot; [@ElVit](https://github.com/ElVit) &middot; [@nchieffo](https://github.com/nchieffo) &middot; [@begunfx](https://github.com/begunfx) &middot; [@Ra72xx](https://github.com/Ra72xx)

<h2 align="center" id="codeswhat-ecosystem">Teil des CodesWhat-Ökosystems</h2>

<table>
  <tbody><tr><th>Werkzeug</th><th>Rolle</th></tr>
  <tr><td><b>drydock</b></td><td>Überwachung von Containeraktualisierungen – Web-Benutzeroberfläche und Benachrichtigungs-Engine</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/portwing"><b>portwing</b></a></td><td>Remote-Docker-Agent – sicherer Zugriff auf Socket-Ebene von Drydock oder Standalone</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/sockguard"><b>sockguard</b></a></td><td>Docker-Socket-Proxy – Standard-Zulassungslistenfilter zum Schutz des Sockets</td></tr>
</tbody></table>

Diese drei Tools sind für die Schichtung konzipiert: sockguard filtert den Socket, portwing macht ihn remote verfügbar und drydock überwacht den Containerstatus und reagiert darauf.

Die vollständige Kompatibilitätsmatrix für alle drei Tools finden Sie in [portwings COMPATIBILITY.md](https://github.com/CodesWhat/portwing/blob/main/COMPATIBILITY.md).

---

**[AGPL-3.0-Lizenz](LICENSE)**

<a href="https://github.com/CodesWhat">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/codeswhat-logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/codeswhat-logo-original.svg" />
    <img src="docs/assets/codeswhat-logo-original.svg" alt="CodesWhat" height="28">
  </picture>
</a>

<a href="#drydock">Zurück nach oben</a>

</div>
