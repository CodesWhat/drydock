<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/whale-logo-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/whale-logo.png" />
  <img src="docs/assets/whale-logo.png" alt="drydock" width="220">
</picture>

<h1>drydock</h1>

**Observador de actualizaciones de imágenes de contenedores: 23 registros, 20 proveedores de notificaciones y acciones.**

<p><a href="README.md">English</a> · <strong>Español</strong> · <a href="README.pl.md">Polski</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.pt-BR.md">Português (Brasil)</a></p>

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
> **¿Actualizando desde una versión anterior? Lea primero las notas de actualización.** Tres correcciones de refuerzo de seguridad se enviaron por primera vez en **1.4.6** y se ejecutan en toda la línea **1.5**, por lo que cualquiera que actualice desde una versión anterior a 1.4.6 se verá afectado independientemente de la versión a la que acceda (1.4.6, cualquier 1.5.x o posterior). No están en desuso y no tienen período de gracia: OIDC ahora requiere `authorization_endpoint` en los metadatos de descubrimiento de su proveedor, claves de limitación de velocidad no autenticadas en la dirección del par TCP (depósito compartido detrás de un proxy inverso) y las URL del proxy de activación HTTP deben usar `http(s)://`. Consulte **[UPGRADE-NOTES.md](UPGRADE-NOTES.md)** antes de actualizar.

<h2 align="center">📑 Contenidos</h2>

- [📖 Documentación](https://getdrydock.com/docs)
- [🚀 Inicio rápido](#quick-start)
- [🆕 Actualizaciones recientes](#recent-updates)
- [📸 Capturas de pantalla y demostración en vivo](#screenshots)
- [🤔 Por qué Drydock](#why-drydock)
- [✨ Características](#features)
- [🔌 Integraciones admitidas](#supported-integrations)
- [⚖️ Comparación de funciones](#feature-comparison)
- [🔄 Migración](#migration)
- [🗺️ Hoja de ruta](#roadmap)
- [⭐ Historia de las estrellas](#star-history)
- [🔧 Construido con](#construido-con)
- [🤝 Comunidad QA](#control-de-calidad-de-la-comunidad)

<hr>

<h2 align="center" id="quick-start">🚀 Inicio rápido</h2>

**Recomendado: use un proxy de socket** para restringir a qué puntos finales de la API de Docker puede acceder Drydock. Esto evita darle al contenedor acceso completo al socket Docker.

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
<summary>Alternativa:<a href="https://github.com/CodesWhat/sockguard">sockguard</a>proxy de socket</summary>

[sockguard](https://github.com/CodesWhat/sockguard) es un filtro de socket Docker de denegación predeterminado del mismo ecosistema CodesWhat, con un ajuste preestablecido creado para drydock:

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

Consulte el ajuste preestablecido [`app/configs/portwing.yaml`](https://github.com/CodesWhat/sockguard/blob/dev/v1.5/app/configs/portwing.yaml) de sockguard para obtener un `sockguard.yaml` inicial (el mismo ajuste preestablecido portwing se envía en sus propios ejemplos).

</details>

<details>
<summary>Alternativa: inicio rápido con montaje directo en enchufe</summary>

```bash
docker run -d \
  --name drydock \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e DD_AUTH_BASIC_ADMIN_USER=admin \
  -e "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>" \
  codeswhat/drydock:latest
```

> **Advertencia:** El acceso directo al socket otorga al contenedor control total sobre el demonio Docker. Utilice la configuración de proxy de socket anterior para implementaciones de producción. Consulte la [Guía de seguridad de Docker Socket](https://getdrydock.com/docs/configuration/watchers#docker-socket-security) para conocer todas las opciones, incluido TLS remoto y Docker sin raíz.

</details>

> Genere un hash de contraseña (`argon2` CLI: instálelo a través de su administrador de paquetes):
>
> ```bash
> echo -n "yourpassword" | argon2 $(openssl rand -base64 32) -id -m 16 -t 3 -p 4 -l 64 -e
> ```
>
> O con Node.js 24+ (no se necesitan paquetes adicionales):
>
> ```bash
> node -e 'const c=require("node:crypto");const s=c.randomBytes(32);const h=c.argon2Sync("argon2id",{message:process.argv[1],nonce:s,memory:65536,passes:3,parallelism:4,tagLength:64});console.log("argon2id$65536$3$4$"+s.toString("base64")+"$"+h.toString("base64"));' "yourpassword"
> ```
>
> Drydock v1.6 acepta solo hash de autenticación básica argon2id. Se rechazan los hashes heredados `{SHA}`, `$apr1$`/`$1$`, `crypt` y de texto sin formato; regenerarlos antes de actualizar.
> La autenticación es **requerida de forma predeterminada**. Consulte los [auth docs](https://getdrydock.com/docs/configuration/authentications) para OIDC, acceso anónimo y otras opciones.
> Para permitir explícitamente el acceso anónimo en instalaciones nuevas, configure `DD_ANONYMOUS_AUTH_CONFIRM=true`.

La imagen incluye archivos binarios `trivy` y `cosign` para escaneo de vulnerabilidades locales y verificación de imágenes.

Consulte la [guía de inicio rápido](https://getdrydock.com/docs/quickstart) para Docker Compose, seguridad de socket, proxy inverso y registros alternativos.

<hr>

<h2 align="center" id="recent-updates">🆕 Actualizaciones recientes</h2>

<details open>
<summary><strong>Aspectos destacados de v1.6.0-rc.2</strong></summary>

- **Notificaciones**: plantillas de cuerpo y título por regla/por proveedor con vista previa en vivo, además de categorías de campana en la aplicación respaldadas por auditorías y umbrales de gravedad de actualización.
- **Panel**: reemplazo de cuadrícula CSS sin dependencia con reordenamiento táctil/ratón, cambio de tamaño limitado, diseños responsivos, visibilidad de widgets, restablecimiento y sincronización opcional de preferencias entre dispositivos.
- **Política de actualización**: precedencia declarativa de observador/etiqueta/UI, anulación/reversión de seguimiento de auditoría, cuenta regresiva de madurez/anulación manual y visibilidad informativa de etiquetas fijadas con una vista de etiquetas actual → más nueva apilada.
- **Rendimiento y recuperación**: deduplicación de listas de etiquetas por encuesta, proyecciones agregadas más ligeras, historiales de registros grandes virtualizados, transferencia de registros en vivo inmutable, tiempo de espera de arranque de autenticación, migraciones de preferencias completas y autocuración de fragmentos obsoletos.
- **Se aplicaron migraciones v1.6**: los alias de entorno/etiqueta WUD, los formatos de autenticación heredados, los conmutadores de vigilancia obsoletos, los alias de plantilla, Kafka `clientId` y las configuraciones públicas de Hub/DHI de solo token con formato incorrecto ya no se ejecutan. Los alias de taxonomía de activación permanecen hasta una publicación final de advertencia de nivel de error.

Guía completa de migración en [DEPRECATION.md](./DEPRECATIONS.md).

</details>

<details>
<summary><strong>v1.5.2 aspectos destacados</strong></summary>

- **Política de actualización segura para la recreación**: las puertas de madurez, las etiquetas/resúmenes omitidos y las posposiciones ahora sobreviven a la recreación de contenedores para cargas de trabajo de agentes locales y remotos.
- **Confiabilidad de etiquetas fijadas**: las etiquetas completamente fijadas detectan reconstrucciones de resúmenes de la misma etiqueta nuevamente, mientras que la interfaz de usuario puede mostrar una etiqueta de la misma familia más nueva y no procesable sin cambiar el comportamiento de actualización o activación.
- **Recuperación de reversión**: la creación de reemplazo, la conexión de red o el inicio fallidos ahora limpian el candidato antes de restaurar el contenedor original, y las fallas repetidas no pueden ocurrir en cascada a través de cambios de nombre de reversión anidados.
- **Recreación de contenedores más segura**: las direcciones MAC asignadas por Daemon ya no se fijan en los reemplazos, mientras que las direcciones MAC de la red primaria configuradas explícitamente permanecen conservadas.
- **Encuesta de imágenes locales más silenciosa**: las imágenes creadas o cargadas localmente sin resumen de registro omiten búsquedas remotas en lugar de generar errores de autorización recurrentes.

Historial completo en [CHANGELOG.md](./CHANGELOG.md).

</details>

<hr>

<h2 align="center" id="screenshots">📸 Capturas de pantalla y demostración en vivo</h2>

<p align="center">
  <img src="docs/assets/drydock-demo.gif" alt="Drydock detecting and applying a container update" width="880">
</p>

<p align="center"><em>Detecte una actualización, vea exactamente qué cambios y aplíquela. Se manejan copias de seguridad, verificación de estado y reversión.</em></p>

<table>
<tr>
<td width="50%" align="center"><strong>Luz</strong></td>
<td width="50%" align="center"><strong>oscuro</strong></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-dashboard-light.png" alt="Dashboard Light"></td>
<td><img src="docs/assets/drydock-dashboard-dark.png" alt="Dashboard Dark"></td>
</tr>
</table>

<div align="center">

**¿Por qué mirar capturas de pantalla cuando puedes experimentarlo tú mismo?**

<a href="https://demo.getdrydock.com"><img src="https://img.shields.io/badge/Try_the_Live_Demo-4f46e5?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSI2IDMgMjAgMTIgNiAyMSA2IDMiLz48L3N2Zz4=&logoColor=white" alt="Try the Live Demo" height="36"></a>

Totalmente interactivo: interfaz de usuario real, datos simulados, no requiere instalación. Se ejecuta completamente en el navegador.

</div>

<hr>

<h2 align="center" id="why-drydock">🤔 Por qué Drydock</h2>

Las imágenes de los contenedores quedan obsoletas silenciosamente. Una imagen base parchea un CVE, una aplicación corta una versión, una etiqueta se mueve. A menos que esté observando cada registro manualmente, sus contenedores en ejecución se retrasan hasta que algo se rompe o es explotado.

La mayoría de las herramientas obligan a hacer concesiones. Los actualizadores automáticos (Watchtower, Ouroboros) se activan y reinician con poca visibilidad o control, y ahora prácticamente no reciben mantenimiento. Los paneles (Portainer) administran contenedores pero no están diseñados para inteligencia de actualización. Drydock es **monitor primero**: observa 23 registros y le dice exactamente qué cambió (mayor, menor, parche o resumen) antes de que suceda algo, luego actúa solo cuando usted lo permite. Y va más allá que cualquiera de ellos. El escaneo de vulnerabilidades Trivy/Grype bloquea actualizaciones no seguras, cosign verifica firmas, las copias de seguridad de imágenes previas a la actualización se revierten automáticamente en caso de falla en la verificación de estado, los agentes distribuidos cubren hosts remotos y 20 integraciones de notificaciones y acciones cierran el ciclo. El ciclo de vida completo de la actualización, con una interfaz de usuario web y una API REST.

<hr>

<h2 align="center" id="features">✨ Características</h2>

| | Característica | Descripción |
|---|---|---|
| 🔭 | **Monitorizar primero la detección** | Observa cada contenedor en ejecución y clasifica cada actualización disponible como principal, menor, parche o resumen antes de que suceda algo. Nada cambia hasta que tú lo digas. |
| 📦 | **23 proveedores de registro** | Docker Hub, GHCR, ECR, ACR, GCR, GAR, GitLab, Quay, Harbour, Artifactory, Nexus y 12 más. Público y privado, en la nube y autohospedado, con autenticación y TLS por registro. |
| 🔔 | **20 activadores** | 17 canales de notificación (Slack, Discord, Telegram, Teams, SMTP, MQTT, ntfy y más) además de acciones de Docker, Docker Compose y Command, con plantillas por evento/proveedor, vista previa en vivo, filtrado de umbral y modo por lotes. |
| 🥊 | **Update Bouncer** | El escaneo de vulnerabilidades Trivy/Grype bloquea las actualizaciones no seguras antes de que se implementen, con verificación de firma conjunta y generación de SBOM (CycloneDX y SPDX). |
| ↩️ | **Copia de seguridad de imágenes y reversión automática** | Instantáneas de imágenes previas a la actualización con retención configurable, reversión automática en caso de falla en la verificación de estado y reversión manual con un solo clic desde la interfaz de usuario. |
| 🪝 | **Ganchos de ciclo de vida** | Comandos de shell previos y posteriores a la actualización a través de etiquetas de contenedor, con tiempos de espera por gancho y control de cancelación en caso de falla. |
| 🗂️ | **Actualizaciones Docker Compose** | Extraiga y vuelva a crear servicios de Compose a través de la API Docker Engine con parches de imágenes que preservan YAML. |
| 🎛️ | **Política por contenedor** | Las reglas de etiquetas Regex y el enrutamiento de activación utilizan etiquetas `dd.*`; Las puertas de madurez, saltar/posponer/fijar y las ventanas de mantenimiento se almacenan a través de UI/API o la configuración del observador. |
| 🛰️ | **Agentes distribuidos** | Supervise hosts Docker remotos a través de SSE. Los agentes perimetrales detrás de NAT marcan a través de WebSocket con autenticación de clave Ed25519, no se requiere puerto de entrada (`DD_EXPERIMENTAL_PORTWING=true`). |
| 🖥️ | **Panel web** | Interfaz de usuario de Vue 3 con una cuadrícula de widgets personalizable sin dependencia, vistas de tablas/tarjetas responsivas, actualizaciones SSE en vivo, controles de campana de notificación y detalles, registros y estadísticas por contenedor. |
| 🔗 | **API REST y webhooks** | Puntos finales autenticados por token para activación de actualizaciones y vigilancia de CI/CD, además de ingesta de webhooks de registro firmados para eventos push. |
| 🔐 | **Autenticación OIDC** | Asegure el tablero con OpenID Connect (Authelia, Auth0, Authentik). Todos los flujos de autenticación fallan al cerrarse de forma predeterminada. |
| 📈 | **Métricas Prometheus** | Punto final `/metrics` incorporado con omisión de autenticación opcional para pilas de monitoreo Prometheus y Grafana. |
| 🌍 | **17 configuraciones regionales de UI** | Sistema de traducción completamente cableado con inglés completo y 16 configuraciones regionales mantenidas por la comunidad sincronizadas a través de Crowdin, conmutables en Config. |
| 🔒 | **Expresión regular inmune a ReDoS** | Cada patrón de etiquetas proporcionado por el usuario se compila a través de re2js (un puerto RE2 JS puro) para una coincidencia de tiempo lineal que no puede detenerse por un patrón de retroceso catastrófico. |

<hr>

<h2 align="center" id="supported-integrations">🔌 Integraciones admitidas</h2>

### 📦 Registros (23)

Docker Hub · GHCR · ECR · ACR · GCR · GAR · GitLab · Muelle · LSCR · Puerto · Artifactory · Nexus · Gitea · Forgejo · Codeberg · MAU · TrueForge · Personalizado · DOCR · DHI · IBM Cloud · Oracle Cloud · Alibaba Cloud

### ⚡ Acciones (3)

Docker · Docker Compose · Comando

### 🔔 Notificaciones (17)

Informar · Discord · Google Chat · Gotify · HTTP · IFTTT · Kafka · Matrix · Mattermost · MQTT · MS Teams · NTFY · Pushover · Rocket.Chat · Slack · SMTP · Telegram

### 🔐 Autenticación

Anónimo (suscripción a través de `DD_ANONYMOUS_AUTH_CONFIRM=true`) · Básico (nombre de usuario + hash de contraseña) · OIDC (Authelia, Auth0, Authentik). Todos los flujos de autenticación fallan al cerrarse de forma predeterminada.

### 🥊 Update Bouncer

El escaneo de vulnerabilidades impulsado por Trivy o Grype bloquea las actualizaciones no seguras antes de que se implementen. Incluye verificación de firma cofirmante y generación de SBOM (CycloneDX y SPDX).

<hr>

<h2 align="center" id="feature-comparison">⚖️ Comparación de funciones</h2>

<details>
<summary><strong>¿Cómo se compara drydock con otras herramientas de actualización de contenedores?</strong></summary>

> ✅ = compatible &nbsp; ❌ = no compatible &nbsp; ⚠️ = parcial/limitado &nbsp; † = archivado, ya no se mantiene

| Feature | drydock | WUD | Diun | *Watchtower †* | *Ouroboros †* |
|---|:---:|:---:|:---:|:---:|:---:|
| Interfaz web / panel | ✅ | ✅ | ❌ | ❌ | ❌ |
| Actualización automática de contenedores | ✅ | ✅ | ❌ | ✅ | ✅ |
| Actualizaciones de Docker Compose | ✅ | ✅ | ❌ | ⚠️ | ❌ |
| Canales de activación / notificación | 20 | 16 | 17 | ~19 | ~6 |
| Proveedores de registro | 23 | 13 | ⚠️ | ⚠️ | ⚠️ |
| Autenticación OIDC / SSO | ✅ | ✅ | ❌ | ❌ | ❌ |
| API REST | ✅ | ✅ | ⚠️ | ⚠️ | ❌ |
| Métricas de Prometheus | ✅ | ✅ | ❌ | ✅ | ✅ |
| MQTT / Home Assistant | ✅ | ✅ | ✅ | ❌ | ❌ |
| Copia y reversión de imágenes | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agrupación de contenedores / stacks | ✅ | ✅ | ❌ | ⚠️ | ❌ |
| Hooks del ciclo de vida (antes/después) | ✅ | ❌ | ❌ | ✅ | ❌ |
| API de webhooks para CI/CD | ✅ | ❌ | ❌ | ✅ | ❌ |
| Iniciar/detener/reiniciar/actualizar contenedores | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agentes distribuidos (remotos) | ✅ | ❌ | ✅ | ⚠️ | ❌ |
| Registro de auditoría | ✅ | ❌ | ❌ | ❌ | ❌ |
| Análisis de seguridad (Trivy/Grype) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Actualizaciones compatibles con SemVer | ✅ | ✅ | ✅ | ❌ | ❌ |
| Vigilancia de resúmenes | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-arquitectura (amd64/arm64) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Visor de registros del contenedor | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mantenimiento activo | ✅ | ✅ | ✅ | ❌ | ❌ |

> Datos basados en documentación disponible públicamente a marzo de 2026.
> Se aceptan contribuciones si alguna información es inexacta.

</details>

<hr>

<h2 align="center" id="migration">🔄 Migración</h2>

<details>
<summary><strong>Migrando desde WUD (¿Qué pasa Docker?)</strong></summary>

Drydock v1.6 ya no carga variables de entorno `WUD_*` o etiquetas `wud.*` en tiempo de ejecución. Vuelva a escribirlos antes de iniciar el servicio actualizado; El estado persistente aún migra automáticamente. Utilice `docker exec -it drydock node dist/index.js config migrate --dry-run` para obtener una vista previa y luego `docker exec -it drydock node dist/index.js config migrate --file .env --file compose.yaml` para reescribir la configuración con los nombres `DD_*` y `dd.*`.

</details>

<hr>

<h2 align="center" id="roadmap">🗺️ Hoja de ruta</h2>

<details>
<summary><strong>Temas y aspectos destacados de la versión</strong></summary>

Solo temas de alto nivel: consulte [CHANGELOG.md](CHANGELOG.md) para obtener detalles por versión.

| Versión | Tema | Aspectos destacados |
| --- | --- | --- |
| **v1.3.x** ✅ | Seguridad y Estabilidad | Escaneo Trivy, Update Bouncer, SBOM, 7 nuevos registros, 4 nuevos activadores, motor re2js regex |
| **v1.4.x** ✅ | Modernización y refuerzo de la interfaz de usuario | Tailwind 4 + componentes personalizados, 6 temas, paleta Cmd/K, OpenAPI 3.1, actualizaciones YAML nativas de redacción, escaneo de doble ranura, refuerzo OIDC |
| **v1.5.0** ✅ | Observabilidad e i18n | división de taxonomía de activación (`DD_ACTION_*`/`DD_NOTIFICATION_*`), visor de registros WebSocket, personalización del panel, monitoreo de recursos, bandeja de salida de notificaciones + DLQ, resumen de escaneo de seguridad, 17 configuraciones regionales, reproducción de ID del último evento SSE, acceso telefónico al agente perimetral con autenticación Ed25519 (experimental, `DD_EXPERIMENTAL_PORTWING=true`) |
| **v1.5.1** ✅ | Seguridad y mantenimiento | Corrección de autenticación de extracción GCR/GAR, finalización de TLS de registro (M-2), refuerzo de inyección de env-var de gancho, compatibilidad con `DD_SESSION_SECRET__FILE`, redacción de credenciales de volcado de depuración, verificación de permisos de archivos secretos, corrección de bloqueo de puerta de madurez, traducibilidad completa de la interfaz de usuario + traducciones de la comunidad, puerta de aplicación automática de ventana de mantenimiento, visualización del tiempo de actividad del contenedor, versión de software de superficie dividida de columna Etiqueta/Versión (etiqueta OCI, con escritura dual `dd.inspect.tag.path` + opción de enrutamiento `dd.inspect.tag.version-only`), opción de coincidencia de prefijo de montaje de composición, var de plantilla `${currentReleaseNotes}` |
| **v1.5.2** ✅ | Política y confiabilidad de etiquetas fijadas | Retención de política de madurez/omisión/posposición segura para recreación, detección de reconstrucción de resumen de etiquetas fijadas e información informativa de la misma familia, limpieza de candidatos de reversión, prevención de cascada de reversión, preservación de MAC explícito y comportamiento de omisión de registro de imágenes locales |
| **v1.6.0** | Notificaciones, políticas y comunicados Intel | Plantillas de notificación por regla/por activador con vista previa en vivo, preferencias de campana de notificación, sincronización de preferencias entre dispositivos, cuadrícula de panel personalizado sin dependencia ([#281](https://github.com/CodesWhat/drydock/issues/281)), política de actualización declarativa ([#320](https://github.com/CodesWhat/drydock/issues/320)), cuenta regresiva de estabilización de madurez + visibilidad inmediata del candidato + anulación manual ([#406](https://github.com/CodesWhat/drydock/discussions/406)), panel de estado de actualización procesable y global Modo de actualización `notify` / `manual` / `auto` ([#325](https://github.com/CodesWhat/drydock/discussions/325)), herencia de políticas de etiquetas de observador/imgset/contenedor más actual apilada → visibilidad de etiquetas fijadas más nuevas ([#498](https://github.com/CodesWhat/drydock/issues/498)), fuente estandarizada de 44 px/notas de la versión/acciones de recursos de registro en tablas, tarjetas y detalles ([#295](https://github.com/CodesWhat/drydock/discussions/295)), notificaciones de eventos de estado de salud ([#198](https://github.com/CodesWhat/drydock/discussions/198)), Home Assistant MQTT bidireccional, vistas responsivas de tablas/listas de tarjetas, Trivy/Grype/análisis a través de comandos o backends de Docker-worker anclados, controles activos/de extracción de activos del escáner, deduplicación fuera del montón Almacenamiento SBOM, corrección de escaneo largo de Trivy ([#490](https://github.com/CodesWhat/drydock/issues/490)), advertencias de migración de taxonomía de activación, eliminaciones de compatibilidad v1.6, higiene de documentos/API y finalización de migración de `/api` → `/api/v1` con una cuña de compatibilidad de página de inicio/tarjeta wud opcional (`DD_COMPAT_WUDCARD`). |
| **v1.7.0** | Actualizaciones inteligentes y UX | Ordenamiento consciente de la dependencia ([#219](https://github.com/CodesWhat/drydock/discussions/219)), actualizaciones masivas selectivas ([#232](https://github.com/CodesWhat/drydock/discussions/232)), política de actualización por acción ([#511](https://github.com/CodesWhat/drydock/discussions/511)), eliminación de imágenes, monitoreo de imágenes estáticas, indicador de madurez de la imagen, reloj unificado de madurez/antigüedad de actualizaciones, enlaces de puertos en los que se puede hacer clic, atajos de teclado, PWA, eliminación de `DD_TRIGGER_*` (fin de la ventana de obsolescencia de v1.5.0), curl eliminado de la imagen |
| **v1.8.0** | Gestión de flotas y configuración en vivo | Configuración YAML, configuración de UI en vivo, navegador de volúmenes, actualizaciones paralelas, migración de la tienda SQLite |
| **v2.0+** | Expansión de plataforma y más allá | Vigilantes de enjambre/Kubernetes, GitOps, puertas de estado, implementaciones canary, terminal web, RBAC, claves API giratorias con alcance (tokens de portador estáticos para integraciones de HA/panel, [#469](https://github.com/CodesWhat/drydock/discussions/469)), LDAP/AD, proveedor nativo de Podman más allá de la API compatible con Docker, CLI, imagen reforzada de Wolfi, proxy de socket |

</details>

<hr>

<h2 align="center" id="documentation">📖 Documentación</h2>

| Recurso | Enlace |
| --- | --- |
| Sitio web | [obtenerdrydock.com](https://getdrydock.com/) |
| Demostración en vivo | [demo.getdrydock.com](https://demo.getdrydock.com) |
| Documentos | [getdrydock.com/docs](https://getdrydock.com/docs) |
| Configuración | [Configuración](https://getdrydock.com/docs/configuration) |
| Inicio rápido | [Inicio rápido](https://getdrydock.com/docs/quickstart) |
| Registro de cambios | [`CHANGELOG.md`](CHANGELOG.md) |
| Depreciaciones | [`DEPRECATIONS.md`](DEPRECATIONS.md) |
| Hoja de ruta | Consulte la sección [Hoja de ruta](#roadmap) más arriba |
| Contribuyendo | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Problemas | [Problemas de GitHub](https://github.com/CodesWhat/drydock/issues) |
| Discusiones | [Discusiones de GitHub](https://github.com/CodesWhat/drydock/discussions): se aceptan solicitudes de funciones e ideas |

<hr>

<a id="star-history"></a>

<div align="center">
  <a href="https://star-history.com/#CodesWhat/drydock&Date">
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=CodesWhat/drydock&type=Date" />
  </a>
</div>

---

<div align="center">

### Construido con

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

### Comunidad

Preguntas, comentarios y soporte temprano: **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**

Presente errores concretos y solicitudes de funciones en **[GitHub Issues](https://github.com/CodesWhat/drydock/issues)** para que no se pierdan en el chat.

### Control de calidad de la comunidad

Gracias a los usuarios que ayudaron a probar las versiones candidatas v1.4.0 y v1.5.0 y reportaron errores:

[@RK62](https://github.com/RK62) &middot; [@flederohr](https://github.com/flederohr) &middot; [@rj10rd](https://github.com/rj10rd) &middot; [@larueli](https://github.com/larueli) &middot; [@Waler](https://github.com/Waler) &middot; [@ElVit](https://github.com/ElVit) &middot; [@nchieffo](https://github.com/nchieffo) &middot; [@begunfx](https://github.com/begunfx) &middot; [@Ra72xx](https://github.com/Ra72xx)

### Parte del ecosistema CodesWhat

<table>
  <tr><th>Herramienta</th><th>Rol</th></tr>
  <tr><td><b>drydock</b></td><td>Monitoreo de actualizaciones de contenedores: interfaz de usuario web y motor de notificaciones</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/portwing"><b>portwing</b></a></td><td>Agente Docker remoto: acceso seguro a nivel de socket desde Drydock o de forma independiente</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/sockguard"><b>sockguard</b></a></td><td>Proxy de socket de Docker: filtro de lista permitida de denegación predeterminada que protege el socket</td></tr>
</table>

Estas tres herramientas están diseñadas para capas: sockguard filtra el socket, portwing lo expone de forma remota y drydock monitorea y actúa sobre el estado del contenedor.

Consulte COMPATIBILITY.md](<https://github.com/CodesWhat/portwing/blob/main/COMPATIBILITY.md>) de [portwing para obtener la matriz de compatibilidad completa entre las tres herramientas.

---

**[Licencia AGPL-3.0](LICENSE)**

<a href="https://github.com/CodesWhat">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/codeswhat-logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/codeswhat-logo-original.svg" />
    <img src="docs/assets/codeswhat-logo-original.svg" alt="CodesWhat" height="28">
  </picture>
</a>

[![Sponsor](https://img.shields.io/badge/Sponsor-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/CodesWhat)

<a href="#drydock">Volver arriba</a>

</div>
