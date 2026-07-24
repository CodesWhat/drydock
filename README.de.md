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

<p align="center">
  <a href="https://github.com/CodesWhat/drydock/releases"><img src="https://img.shields.io/badge/version-1.6.0--rc.2-blue" alt="Version"></a>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-informational?logo=linux&logoColor=white" alt="Multi-arch"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-C9A227" alt="License AGPL-3.0"></a>
  <br>
  <a href="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml"><img src="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/CodesWhat/drydock"><img src="https://img.shields.io/ossf-scorecard/github.com/CodesWhat/drydock?label=openssf+scorecard&style=flat" alt="OpenSSF Scorecard"></a>
  <a href="https://qlty.sh/gh/CodesWhat/projects/drydock"><img src="https://qlty.sh/gh/CodesWhat/projects/drydock/test_coverage.svg" alt="Code Coverage"></a>
  <a href="https://dashboard.stryker-mutator.io/reports/github.com/CodesWhat/drydock/main"><img src="https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2FCodesWhat%2Fdrydock%2Fmain" alt="Mutation testing"></a>
  <br>
  <a href="https://github.com/CodesWhat/drydock/pkgs/container/drydock"><img src="https://img.shields.io/badge/GHCR-150K%2B_pulls-2ea44f?logo=github&logoColor=white" alt="GHCR pulls"></a>
  <a href="https://github.com/veggiemonk/awesome-docker#container-management"><img src="https://awesome.re/mentioned-badge.svg" alt="Mentioned in Awesome Docker"></a>
  <a href="https://crowdin.com/project/drydock"><img src="https://badges.crowdin.net/drydock/localized.svg" alt="Crowdin localization"></a>
</p>

<hr>

> [!WARNING]
> **Aktualisierung von einer älteren Version? Lesen Sie zuerst die Upgrade-Hinweise.** Drei Korrekturen zur Sicherheitsverstärkung wurden erstmals in **1.4.6** ausgeliefert und durchlaufen die gesamte **1.5**-Reihe, sodass jeder, der von einer Version älter als 1.4.6 aktualisiert, davon betroffen ist, unabhängig davon, auf welcher Version er landet (1.4.6, jede 1.5.x oder höher). Sie sind keine veralteten Versionen und haben keine Kulanzfrist: OIDC erfordert jetzt `authorization_endpoint` in den Erkennungsmetadaten Ihres Anbieters, nicht authentifizierte ratenbegrenzende Schlüssel auf der TCP-Peer-Adresse (gemeinsamer Bucket hinter einem Reverse-Proxy) und HTTP-Trigger-Proxy-URLs müssen `http(s)://` verwenden. Lesen Sie vor der Aktualisierung **[UPGRADE-NOTES.md](UPGRADE-NOTES.md)**.

<h2 align="center">📑 Inhalt</h2>

- [📖 Dokumentation](https://getdrydock.com/docs)
- [🚀 Schnellstart](#quick-start)
- [🆕 Aktuelle Updates](#recent-updates)
- [📸 Screenshots & Live-Demo](#screenshots)
- [🤔 Warum Drydock](#why-drydock)
- [✨ Eigenschaften](#features)
- [🔌 Unterstützte Integrationen](#supported-integrations)
- [⚖️ Funktionsvergleich](#feature-comparison)
- [🔄 Migration](#migration)
- [🗺️ Roadmap](#roadmap)
- [⭐ Sterngeschichte](#star-history)
- [🔧 Gebaut mit](#gebaut-mit)
- [🤝 Community QA](#community-qa)

<hr>

<h2 align="center" id="quick-start">🚀 Schnellstart</h2>

**Empfohlen: Verwenden Sie einen Socket-Proxy**, um einzuschränken, auf welche Docker-API-Endpunkte Drydock zugreifen kann. Dadurch wird vermieden, dass der Container vollen Zugriff auf den Docker-Socket erhält.

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      socket-proxy:
        condition: service_healthy
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
```

<details>
<summary>Alternativ:<a href="https://github.com/CodesWhat/sockguard">sockguard</a>Socket-Proxy</summary>

[sockguard](https://github.com/CodesWhat/sockguard) ist ein standardmäßig verweigernder Docker-Socket-Filter aus demselben CodesWhat-Ökosystem mit einer für drydock erstellten Voreinstellung:

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      sockguard:
        condition: service_healthy
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
  -e DD_AUTH_BASIC_ADMIN_USER=admin \
  -e "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>" \
  codeswhat/drydock:latest
```

> **Warnung:** Der direkte Socket-Zugriff gewährt dem Container die volle Kontrolle über den Docker-Daemon. Verwenden Sie das oben beschriebene Socket-Proxy-Setup für Produktionsbereitstellungen. Im [Docker Socket Security Guide](https://getdrydock.com/docs/configuration/watchers#docker-socket-security) finden Sie alle Optionen, einschließlich Remote-TLS und rootless Docker.

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
> Um den anonymen Zugriff bei Neuinstallationen explizit zuzulassen, legen Sie `DD_ANONYMOUS_AUTH_CONFIRM=true` fest.

Das Image enthält die Binärdateien `trivy` und `cosign` für die lokale Suche nach Schwachstellen und die Image-Verifizierung.

Weitere Informationen zu Docker Compose, Socket-Sicherheit, Reverse-Proxy und alternativen Registrierungen finden Sie im [Quick Start Guide](https://getdrydock.com/docs/quickstart).

<hr>

<h2 align="center" id="recent-updates">🆕 Aktuelle Updates</h2>

<details open>
<summary><strong>v1.6.0-rc.2 Highlights</strong></summary>

- **Benachrichtigungen** – Titel- und Textvorlagen pro Regel/pro Anbieter mit Live-Vorschau sowie prüfungsgestützten In-App-Klingelkategorien und Schwellenwerten für den Aktualisierungsschweregrad.
- **Dashboard** – CSS-Rasterersatz ohne Abhängigkeit mit Maus-/Touch-Neuordnung, begrenzter Größenänderung, responsiven Layouts, Widget-Sichtbarkeit, Zurücksetzen und optionaler geräteübergreifender Präferenzsynchronisierung.
- **Aktualisierungsrichtlinie** – Deklarative Watcher-/Label-/UI-Priorität, Audit-Trail überschreiben/zurücksetzen, Fälligkeits-Countdown/manuelles Überschreiben und Informationssichtbarkeit angehefteter Tags mit einer gestapelten aktuellen → neueren Tag-Ansicht.
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

<h2 align="center" id="screenshots">📸 Screenshots und Live-Demo</h2>

<p align="center">
  <img src="docs/assets/drydock-demo.gif" alt="Drydock detecting and applying a container update" width="880">
</p>

<p align="center"><em>Erkennen Sie ein Update, sehen Sie genau, welche Änderungen sich ergeben, und wenden Sie es an. Sicherung, Gesundheitsprüfung und Rollback werden durchgeführt.</em></p>

<table>
<tr>
<td width="50%" align="center"><strong>Licht</strong></td>
<td width="50%" align="center"><strong>Dunkel</strong></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-dashboard-light.png" alt="Dashboard Light"></td>
<td><img src="docs/assets/drydock-dashboard-dark.png" alt="Dashboard Dark"></td>
</tr>
</table>

<div align="center">

**Warum Screenshots anschauen, wenn Sie es selbst erleben können?**

<a href="https://demo.getdrydock.com"><img src="https://img.shields.io/badge/Try_the_Live_Demo-4f46e5?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSI2IDMgMjAgMTIgNiAyMSA2IDMiLz48L3N2Zz4=&logoColor=white" alt="Try the Live Demo" height="36"></a>

Vollständig interaktiv – echte Benutzeroberfläche, Scheindaten, keine Installation erforderlich. Läuft vollständig im Browser.

</div>

<hr>

<h2 align="center" id="why-drydock">🤔 Warum Drydock</h2>

Containerbilder veralten stillschweigend. Ein Basisimage patcht ein CVE, eine App schneidet eine Version, ein Tag wird verschoben. Sofern Sie nicht jede Registrierung manuell überwachen, bleiben Ihre laufenden Container zurück, bis etwas kaputt geht oder ausgenutzt wird.

Die meisten Tools erzwingen einen Kompromiss. Die Auto-Updater (Watchtower, Ouroboros) ziehen und starten mit wenig Sichtbarkeit oder Kontrolle neu und werden jetzt weitgehend nicht mehr gewartet. Die Dashboards (Portainer) verwalten Container, sind jedoch nicht für Update-Intelligenz konzipiert. Drydock ist **monitor-first**: Es überwacht 23 Register und teilt Ihnen genau mit, was sich geändert hat (Major, Minor, Patch oder Digest), bevor etwas passiert, und reagiert dann nur, wenn Sie es zulassen. Und es geht weiter als alle anderen. Trivy/Grype Schwachstellenscans blockieren unsichere Updates, Cosign überprüft Signaturen, Image-Backups vor dem Update werden automatisch zurückgesetzt, wenn die Integritätsprüfung fehlschlägt, verteilte Agents decken Remote-Hosts ab und 20 Benachrichtigungs- und Aktionsintegrationen schließen den Kreis. Der vollständige Update-Lebenszyklus mit einer Web-Benutzeroberfläche und einer REST-API.

<hr>

<h2 align="center" id="features">✨ Funktionen</h2>

| | Funktion | Beschreibung |
|---|---|---|
| 🔭 | **Monitor-First-Erkennung** | Überwacht jeden laufenden Container und klassifiziert jedes verfügbare Update als Haupt-, Neben-, Patch- oder Digest-Update, bevor etwas passiert. Es ändert sich nichts, bis Sie es sagen. |
| 📦 | **23 Registrierungsanbieter** | Docker Hub, GHCR, ECR, ACR, GCR, GAR, GitLab, Quay, Harbour, Artifactory, Nexus und 12 weitere. Öffentlich und privat, in der Cloud und selbst gehostet, mit TLS und Authentifizierung pro Registrierung. |
| 🔔 | **20 Auslöser** | 17 Benachrichtigungskanäle (Slack, Discord, Telegram, Teams, SMTP, MQTT, ntfy und mehr) plus Docker-, Docker Compose- und Command-Aktionen, mit Vorlagen pro Ereignis/Anbieter, Live-Vorschau, Schwellenwertfilterung und Batch-Modus. |
| 🥊 | **Update Bouncer** | Der Schwachstellenscan Trivy/Grype blockiert unsichere Updates vor der Bereitstellung, mit Cosign-Signaturüberprüfung und SBOM-Generierung (CycloneDX und SPDX). |
| ↩️ | **Image-Sicherung und automatisches Rollback** | Image-Snapshots vor dem Update mit konfigurierbarer Aufbewahrung, automatischem Rollback bei fehlgeschlagener Integritätsprüfung und manuellem Rollback mit einem Klick über die Benutzeroberfläche. |
| 🪝 | **Lebenszyklus-Hooks** | Shell-Befehle vor und nach dem Update über Container-Labels, mit Zeitüberschreitungen pro Hook und Steuerung des Abbruchs bei Fehler. |
| 🗂️ | **Docker Compose-Updates** | Ziehen Sie Compose-Dienste über die Docker Engine-API mit YAML-erhaltendem Image-Patching ab und erstellen Sie sie neu. |
| 🎛️ | **Richtlinie pro Container** | Regex-Tag-Regeln und Trigger-Routing verwenden `dd.*`-Labels; Reifegrenzen, Skip/Snooze/Pin und Wartungsfenster werden über die Benutzeroberfläche/API oder die Watcher-Konfiguration gespeichert. |
| 🛰️ | **Verteilte Agenten** | Überwachen Sie Remote-Docker-Hosts über SSE. Edge-Agents hinter NAT wählen sich über WebSocket mit Ed25519-Schlüsselauthentifizierung aus, kein eingehender Port erforderlich (`DD_EXPERIMENTAL_PORTWING=true`). |
| 🖥️ | **Web-Dashboard** | Vue 3-Benutzeroberfläche mit einem anpassbaren Widget-Raster ohne Abhängigkeiten, reaktionsfähigen Tabellen-/Kartenansichten, Live-SSE-Updates, Steuerelementen für Benachrichtigungsglocken sowie Details, Protokollen und Statistiken pro Container. |
| 🔗 | **REST-API und Webhooks** | Token-authentifizierte Endpunkte für CI/CD-Überwachungs- und Update-Trigger sowie signierte Registrierungs-Webhook-Aufnahme für Push-Ereignisse. |
| 🔐 | **OIDC-Authentifizierung** | Sichern Sie das Dashboard mit OpenID Connect (Authelia, Auth0, Authentik). Alle Authentifizierungsflüsse werden standardmäßig nicht geschlossen. |
| 📈 | **Prometheus-Metriken** | Integrierter `/metrics`-Endpunkt mit optionaler Authentifizierungsumgehung für die Überwachungsstacks Prometheus und Grafana. |
| 🌍 | **17 UI-Gebietsschemas** | Vollständig verkabeltes Übersetzungssystem mit vollständigem Englisch und 16 von der Community gepflegten Gebietsschemas, synchronisiert über Crowdin, umschaltbar in Config. |
| 🔒 | **ReDoS-Immune Regex** | Jedes vom Benutzer bereitgestellte Tag-Muster wird über re2js (einen reinen JS-RE2-Port) für einen linearen Zeitabgleich kompiliert, der nicht durch ein katastrophales Backtracking-Muster blockiert werden kann. |

<hr>

<h2 align="center" id="supported-integrations">🔌 Unterstützte Integrationen</h2>

### 📦 Register (23)

Docker Hub · GHCR · ECR · ACR · GCR · GAR · GitLab · Quay · LSCR · Harbor · Artifactory · Nexus · Gitea · Forgejo · Codeberg · MAU · TrueForge · Custom · DOCR · DHI · IBM Cloud · Oracle Cloud · Alibaba Cloud

### ⚡ Aktionen (3)

Docker · Docker Compose · Befehl

### 🔔 Benachrichtigungen (17)

Apprise · Discord · Google Chat · Gotify · HTTP · IFTTT · Kafka · Matrix · Mattermost · MQTT · MS Teams · NTFY · Pushover · Rocket.Chat · Slack · SMTP · Telegram

### 🔐 Authentifizierung

Anonym (Opt-in über `DD_ANONYMOUS_AUTH_CONFIRM=true`) · Basic (Benutzername + Passwort-Hash) · OIDC (Authelia, Auth0, Authentik). Alle Authentifizierungsflüsse werden standardmäßig nicht geschlossen.

### 🥊 Update Bouncer

Trivy- oder Grype-gestützte Schwachstellenscans blockieren unsichere Updates, bevor sie bereitgestellt werden. Beinhaltet Cosign-Signaturüberprüfung und SBOM-Generierung (CycloneDX & SPDX).

<hr>

<h2 align="center" id="feature-comparison">⚖️ Funktionsvergleich</h2>

<details>
<summary><strong>Wie schneidet drydock im Vergleich zu anderen Container-Update-Tools ab?</strong></summary>

> ✅ = unterstützt &nbsp; ❌ = nicht unterstützt &nbsp; ⚠️ = teilweise / begrenzt &nbsp; † = archiviert, nicht mehr gepflegt

| Feature | drydock | WUD | Diun | *Watchtower †* | *Ouroboros †* |
|---|:---:|:---:|:---:|:---:|:---:|
| Weboberfläche / Dashboard | ✅ | ✅ | ❌ | ❌ | ❌ |
| Automatische Container-Updates | ✅ | ✅ | ❌ | ✅ | ✅ |
| Docker-Compose-Updates | ✅ | ✅ | ❌ | ⚠️ | ❌ |
| Trigger-/Benachrichtigungskanäle | 20 | 16 | 17 | ~19 | ~6 |
| Registry-Anbieter | 23 | 13 | ⚠️ | ⚠️ | ⚠️ |
| OIDC-/SSO-Authentifizierung | ✅ | ✅ | ❌ | ❌ | ❌ |
| REST-API | ✅ | ✅ | ⚠️ | ⚠️ | ❌ |
| Prometheus-Metriken | ✅ | ✅ | ❌ | ✅ | ✅ |
| MQTT / Home Assistant | ✅ | ✅ | ✅ | ❌ | ❌ |
| Image-Sicherung und Rollback | ✅ | ❌ | ❌ | ❌ | ❌ |
| Container-Gruppierung / Stacks | ✅ | ✅ | ❌ | ⚠️ | ❌ |
| Lifecycle-Hooks (vor/nach) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Webhook-API für CI/CD | ✅ | ❌ | ❌ | ✅ | ❌ |
| Container starten/stoppen/neustarten/aktualisieren | ✅ | ❌ | ❌ | ❌ | ❌ |
| Verteilte Agenten (remote) | ✅ | ❌ | ✅ | ⚠️ | ❌ |
| Audit-Protokoll | ✅ | ❌ | ❌ | ❌ | ❌ |
| Sicherheitsscans (Trivy/Grype) | ✅ | ❌ | ❌ | ❌ | ❌ |
| SemVer-fähige Updates | ✅ | ✅ | ✅ | ❌ | ❌ |
| Digest-Überwachung | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-Architektur (amd64/arm64) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Container-Loganzeige | ✅ | ❌ | ❌ | ❌ | ❌ |
| Aktiv gepflegt | ✅ | ✅ | ✅ | ❌ | ❌ |

> Daten basieren auf öffentlich zugänglicher Dokumentation, Stand März 2026.
> Beiträge willkommen, wenn Informationen ungenau sind.

</details>

<hr>

<h2 align="center" id="migration">🔄Migration</h2>

<details>
<summary><strong>Migration von WUD (What's Up Docker?)</strong></summary>

Drydock v1.6 lädt zur Laufzeit keine `WUD_*`-Umgebungsvariablen oder `wud.*`-Labels mehr. Schreiben Sie sie neu, bevor Sie den aktualisierten Dienst starten. Der persistente Status wird weiterhin automatisch migriert. Verwenden Sie `docker exec -it drydock node dist/index.js config migrate --dry-run` für die Vorschau und dann `docker exec -it drydock node dist/index.js config migrate --file .env --file compose.yaml`, um die Konfiguration in die Namen `DD_*` und `dd.*` umzuschreiben.

</details>

<hr>

<h2 align="center" id="roadmap">🗺️ Roadmap</h2>

<details>
<summary><strong>Versionsthemen und Highlights</strong></summary>

Nur High-Level-Themes – siehe [CHANGELOG.md](CHANGELOG.md) für Details pro Release.

| Version | Thema | Höhepunkte |
| --- | --- | --- |
| **v1.3.x** ✅ | Sicherheit und Stabilität | Trivy-Scanning, Update Bouncer, SBOM, 7 neue Register, 4 neue Trigger, re2js-Regex-Engine |
| **v1.4.x** ✅ | UI-Modernisierung und -Härtung | Tailwind 4 + benutzerdefinierte Komponenten, 6 Themes, Cmd/K-Palette, OpenAPI 3.1, Compose-native YAML-Updates, Dual-Slot-Scanning, OIDC-Härtung |
| **v1.5.0** ✅ | Beobachtbarkeit & i18n | Trigger-Taxonomie-Aufteilung (`DD_ACTION_*`/`DD_NOTIFICATION_*`), WebSocket-Protokollanzeige, Dashboard-Anpassung, Ressourcenüberwachung, Benachrichtigungsausgang + DLQ, Sicherheitsscan-Digest, 17 Gebietsschemas, SSE Last-Event-ID-Wiedergabe, Edge-Agent-Dial-Out mit Ed25519-Authentifizierung (experimentell, `DD_EXPERIMENTAL_PORTWING=true`) |
| **v1.5.1** ✅ | Sicherheit und Wartung | GCR/GAR-Pull-Auth-Fix, Registry-TLS-Vervollständigung (M-2), Hook-Env-Var-Injection-Hardening, `DD_SESSION_SECRET__FILE`-Unterstützung, Debug-Dump-Anmeldeinformationsredaktion, Berechtigungsprüfung für geheime Dateien, Deadlock-Fix für Reifegradtore, vollständige UI-Übersetzbarkeit + Community-Übersetzungen, automatisches Apply-Gate für Wartungsfenster, Container-Verfügbarkeitsanzeige, Tag/Version-Spalten-Split-Surface-Softwareversion (OCI-Label, mit `dd.inspect.tag.path` Dual-Write + Opt-in `dd.inspect.tag.version-only` Routing), Opt-in Compose Mount-Präfix-Matching, `${currentReleaseNotes}` Template Var |
| **v1.5.2** ✅ | Zuverlässigkeit von Richtlinien und angehefteten Tags | Erholungssichere Aufbewahrung von Fälligkeits-/Skip-/Snooze-Richtlinien, Digest-Neuerstellungserkennung mit angehefteten Tags und informative Einblicke in die gleiche Familie, Rollback-Kandidaten-Bereinigung, Rollback-Kaskaden-Verhinderung, explizite MAC-Bewahrung und Verhalten beim Überspringen lokaler Images in der Registrierung |
| **v1.6.0** | Benachrichtigungen, Richtlinien und Veröffentlichungen Intel | Benachrichtigungsvorlagen pro Regel/pro Auslöser mit Live-Vorschau, Benachrichtigungsglocken-Einstellungen, geräteübergreifender Präferenzsynchronisierung, benutzerdefiniertem Dashboard-Raster ohne Abhängigkeit ([#281](https://github.com/CodesWhat/drydock/issues/281)), deklarativer Aktualisierungsrichtlinie ([#320](https://github.com/CodesWhat/drydock/issues/320)), Reifegradstabilisierungs-Countdown + sofortiger Kandidatensichtbarkeit + manueller Überschreibung ([#406](https://github.com/CodesWhat/drydock/discussions/406)), umsetzbarem Update-Status-Panel und global `notify` / `manual` / `auto` Aktualisierungsmodus ([#325](https://github.com/CodesWhat/drydock/discussions/325)), Watcher-/imgset-/Container-Tag-Richtlinienvererbung plus gestapelte aktuelle → neuere Sichtbarkeit angehefteter Tags ([#498](https://github.com/CodesWhat/drydock/issues/498)), standardisierte 44px-Quelle/Versionshinweise/Registrierungsressourcenaktionen für Tabelle, Karten und Details ([#295](https://github.com/CodesWhat/drydock/discussions/295)), Ereignisbenachrichtigungen zum Gesundheitsstatus ([#198](https://github.com/CodesWhat/drydock/discussions/198)), bidirektionales Home Assistant MQTT, reaktionsfähige Tabellen-/Kartenlistenansichten, Trivy/Grype/Scannen über Befehl oder angeheftete Docker-Worker-Backends, Scanner-Asset-Pull/Warm-Steuerung, Off-Heap-Deduplizierung SBOM-Speicher, Trivy Long-Scan-Korrektheit ([#490](https://github.com/CodesWhat/drydock/issues/490)), Trigger-Taxonomie-Migrationswarnungen, v1.6-Kompatibilitätsentfernungen, Dokumentation/API-Hygiene und `/api` → `/api/v1`-Migrationsabschluss mit einem optionalen Wud-Card/Homepage-Kompatibilitäts-Shim (`DD_COMPAT_WUDCARD`). |
| **v1.7.0** | Intelligente Updates und UX | Abhängigkeitsbewusste Reihenfolge ([#219](https://github.com/CodesWhat/drydock/discussions/219)), selektive Massenaktualisierungen ([#232](https://github.com/CodesWhat/drydock/discussions/232)), Aktualisierungsrichtlinie pro Aktion ([#511](https://github.com/CodesWhat/drydock/discussions/511)), Bildbereinigung, statische Bildüberwachung, Bildreifeanzeige, einheitliche Reife-/Update-Alters-Uhr, anklickbare Port-Links, Tastaturkürzel, PWA, Entfernung von `DD_TRIGGER_*` (Ende der veralteten Version 1.5.0). Fenster), Curl aus dem Bild entfernt |
| **v1.8.0** | Flottenmanagement und Live-Konfiguration | YAML-Konfiguration, Live-UI-Konfiguration, Volume-Browser, parallele Updates, SQLite-Store-Migration |
| **v2.0+** | Plattformerweiterung und darüber hinaus | Swarm/Kubernetes-Watcher, GitOps, Health Gates, Canary Deployments, Webterminal, RBAC, bereichsbezogene rotierbare API-Schlüssel (statische Bearer-Tokens für HA/Dashboard-Integrationen, [#469](https://github.com/CodesWhat/drydock/discussions/469)), LDAP/AD, nativer Podman-Anbieter über die Docker-kompatible API hinaus, CLI, gehärtetes Wolfi-Image, Socket-Proxy |

</details>

<hr>

<h2 align="center" id="documentation">📖 Dokumentation</h2>

| Ressource | Link |
| --- | --- |
| Website | [getdrydock.com](https://getdrydock.com/) |
| Live-Demo | [demo.getdrydock.com](https://demo.getdrydock.com) |
| Dokumente | [getdrydock.com/docs](https://getdrydock.com/docs) |
| Konfiguration | [Konfiguration](https://getdrydock.com/docs/configuration) |
| Schnellstart | [Schnellstart](https://getdrydock.com/docs/quickstart) |
| Änderungsprotokoll | [`CHANGELOG.md`](CHANGELOG.md) |
| Abschreibungen | [`DEPRECATIONS.md`](DEPRECATIONS.md) |
| Roadmap | Siehe den Abschnitt [„Roadmap“](#roadmap) oben |
| Mitwirken | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Probleme | [GitHub Issues](https://github.com/CodesWhat/drydock/issues) |
| Diskussionen | [GitHub Discussions](https://github.com/CodesWhat/drydock/discussions) – Funktionsanfragen und Ideen willkommen |

<hr>

<a id="star-history"></a>

<div align="center">
  <a href="https://star-history.com/#CodesWhat/drydock&Date">
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=CodesWhat/drydock&type=Date" />
  </a>
</div>

---

<div align="center">

### Gebaut mit

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

### Gemeinschaft

Fragen, Feedback und frühzeitige Unterstützung: **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**

Bitte reichen Sie konkrete Fehler und Funktionsanfragen in **[GitHub Issues](https://github.com/CodesWhat/drydock/issues)** ein, damit diese nicht im Chat verloren gehen.

### Community-QA

Vielen Dank an die Benutzer, die beim Testen der Release-Kandidaten v1.4.0 und v1.5.0 geholfen und Fehler gemeldet haben:

[@RK62](https://github.com/RK62) &middot; [@flederohr](https://github.com/flederohr) &middot; [@rj10rd](https://github.com/rj10rd) &middot; [@larueli](https://github.com/larueli) &middot; [@Waler](https://github.com/Waler) &middot; [@ElVit](https://github.com/ElVit) &middot; [@nchieffo](https://github.com/nchieffo) &middot; [@begunfx](https://github.com/begunfx) &middot; [@Ra72xx](https://github.com/Ra72xx)

### Teil des CodesWhat-Ökosystems

<table>
  <tr><th>Werkzeug</th><th>Rolle</th></tr>
  <tr><td><b>drydock</b></td><td>Überwachung von Containeraktualisierungen – Web-Benutzeroberfläche und Benachrichtigungs-Engine</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/portwing"><b>portwing</b></a></td><td>Remote-Docker-Agent – sicherer Zugriff auf Socket-Ebene von Drydock oder Standalone</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/sockguard"><b>sockguard</b></a></td><td>Docker-Socket-Proxy – Standard-Zulassungslistenfilter zum Schutz des Sockets</td></tr>
</table>

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

[![Sponsor](https://img.shields.io/badge/Sponsor-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/CodesWhat)

<a href="#drydock">Zurück nach oben</a>

</div>
