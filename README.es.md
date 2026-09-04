<div align="center">

<p><a href="README.md">English</a> · <strong>Español</strong> · <a href="README.pl.md">Polski</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.pt-BR.md">Português (Brasil)</a></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/whale-logo-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/whale-logo.png" />
  <img src="docs/assets/whale-logo.png" alt="drydock" width="220">
</picture>

<h1>drydock</h1>

**Observador de actualizaciones de imágenes de contenedores: 23 registros, 20 proveedores de notificaciones y acciones.**

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
> **¿Actualizando desde una versión anterior? Lea primero las notas de actualización.** Tres correcciones de refuerzo de seguridad se enviaron por primera vez en **1.4.6** y se ejecutan en toda la línea **1.5**, por lo que cualquiera que actualice desde una versión anterior a 1.4.6 se verá afectado independientemente de la versión a la que acceda (1.4.6, cualquier 1.5.x o posterior). No están en desuso y no tienen período de gracia: OIDC ahora requiere `authorization_endpoint` en los metadatos de descubrimiento de su proveedor, claves de limitación de velocidad no autenticadas en la dirección del par TCP (depósito compartido detrás de un proxy inverso) y las URL del proxy de activación HTTP deben usar `http(s)://`. Consulte **[UPGRADE-NOTES.md](UPGRADE-NOTES.md)** antes de actualizar.

<!-- separate alerts: a blank-line-only gap between blockquotes trips markdownlint MD028 -->

> [!WARNING]
> **¿Actualizando a 1.6.0-rc.3 o posterior?** Se aplican más refuerzos de seguridad sin período de gracia. Una instancia sin autenticación configurada, o con autenticación anónima habilitada pero no confirmada, ahora se cierra de forma segura al actualizar, igual que una instalación nueva: el contenedor sigue ejecutándose; las solicitudes protegidas de la API devuelven `401`; las rutas públicas de descubrimiento y estado de autenticación siguen disponibles; y `/health` devuelve `503`. La interfaz SPA puede cargar, pero no puede leer datos protegidos. Configure `DD_ANONYMOUS_AUTH_CONFIRM=true` o `DD_AUTH_BASIC_*`/OIDC antes de actualizar. La cookie de sesión cambia de `connect.sid` a `drydock.sid`, cerrando una vez todas las sesiones existentes. Los activadores HTTP, el webhook de Hass y las descargas de iconos de registros ahora resuelven nombres mediante una consulta DNS protegida que bloquea destinos de metadatos de nube y link-local, y nunca sigue redirecciones. Use `allowmetadata=true` solo en un activador `DD_NOTIFICATION_HTTP_*` que realmente lo necesite. Consulte **[DEPRECATIONS.md](DEPRECATIONS.md#enforced-security-changes-no-deprecation-window)** para ver la guía completa.

<h2 align="center">Contenidos</h2>

- [Documentación](#documentation)
- [Inicio rápido](#quick-start)
- [Actualizaciones recientes](#recent-updates)
- [Capturas de pantalla y demostración en vivo](#screenshots)
- [Por qué Drydock](#why-drydock)
- [Características](#features)
- [Integraciones admitidas](#supported-integrations)
- [Comparación de funciones](#feature-comparison)
- [Migración](#migration)
- [Hoja de ruta](#roadmap)
- [Historia de las estrellas](#star-history)
- [Construido con](#built-with)
- [Comunidad y soporte](#community-support)
- [Ecosistema CodesWhat](#codeswhat-ecosystem)

<h2 align="center" id="documentation">Documentación</h2>

| Recurso               | Enlace                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Sitio web             | [obtenerdrydock.com](https://getdrydock.com/)                                                                          |
| Demostración en vivo  | [demo.getdrydock.com](https://demo.getdrydock.com)                                                     |
| Documentos            | [getdrydock.com/docs](https://getdrydock.com/docs)                                                                     |
| Configuración         | [Configuración](https://getdrydock.com/docs/configuration)                                                                             |
| Inicio rápido         | [Inicio rápido](https://getdrydock.com/docs/quickstart)                                                                                |
| Registro de cambios   | [`CHANGELOG.md`](CHANGELOG.md)                                                                                                         |
| Deprecations          | [`DEPRECATIONS.md`](DEPRECATIONS.md)                                                                                                   |
| Hoja de ruta          | Consulte la sección [Hoja de ruta](#roadmap) más abajo                                                                                |
| Contribuyendo         | [`CONTRIBUTING.md`](CONTRIBUTING.md)                                                                                                   |
| Código de conducta    | [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)                                                                                             |
| Governance            | [`GOVERNANCE.md`](GOVERNANCE.md)                                                                                                       |
| Garantía de seguridad | [`SECURITY-ASSURANCE.md`](SECURITY-ASSURANCE.md)                                                                                       |
| Política de seguridad | [`SECURITY.md`](SECURITY.md)                                                                                                           |
| Problemas             | [Problemas de GitHub](https://github.com/CodesWhat/drydock/issues)                                                                     |
| Discusiones           | [Discusiones de GitHub](https://github.com/CodesWhat/drydock/discussions): se aceptan solicitudes de funciones e ideas |

<hr>

<h2 align="center" id="quick-start">Inicio rápido</h2>

**Recomendado: use un proxy de socket** para restringir a qué puntos finales de la API de Docker puede acceder Drydock. Esto evita darle al contenedor acceso completo al socket Docker.

> **Nota:** Compose trata `$` como sintaxis de interpolación de variables, por lo que un hash argon2id pegado con un solo `$` llega a Drydock dañado. Duplique cada `$` como `$$` al pegar el hash real, por ejemplo `$$argon2id$$v=19$$m=65536,t=3,p=4$$salt$$hash`.

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
<summary>Alternativa: <a href="https://github.com/CodesWhat/sockguard">sockguard</a> proxy de socket</summary>

[sockguard](https://github.com/CodesWhat/sockguard) es un filtro de socket Docker de denegación predeterminado del mismo ecosistema CodesWhat, con un ajuste preestablecido creado para drydock:

> **Nota:** Compose trata `$` como sintaxis de interpolación de variables, por lo que un hash argon2id pegado con un solo `$` llega a Drydock dañado. Duplique cada `$` como `$$` al pegar el hash real, por ejemplo `$$argon2id$$v=19$$m=65536,t=3,p=4$$salt$$hash`.

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

Consulte el ajuste preestablecido [`app/configs/portwing.yaml`](https://github.com/CodesWhat/sockguard/blob/dev/v1.5/app/configs/portwing.yaml) de sockguard para obtener un `sockguard.yaml` inicial (el mismo ajuste preestablecido portwing se envía en sus propios ejemplos).

</details>

<details>
<summary>Alternativa: inicio rápido con montaje directo en enchufe</summary>

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

> **Advertencia:** El acceso directo al socket otorga al contenedor control total sobre el demonio Docker. Utilice la configuración de proxy de socket anterior para implementaciones de producción. Consulte la [Guía de seguridad de Docker Socket](https://getdrydock.com/docs/configuration/watchers#docker-socket-security) para conocer todas las opciones, incluido TLS remoto y Docker sin raíz.
>
> Use comillas simples alrededor del valor del hash, como se muestra. Las comillas dobles permiten que el shell expanda `$` antes de que docker lo vea, dañando un hash argon2id real.

</details>

> Genere un hash de contraseña (`argon2` CLI: instálelo a través de su administrador de paquetes):
>
> ```bash
> echo -n "yourpassword" | argon2 $(openssl rand -base64 32) -id -m 16 -t 3 -p 4 -l 64 -e
> ```
>
> O con Node.js 24.7+ (no se necesitan paquetes adicionales):
>
> ```bash
> node -e 'const c=require("node:crypto");const s=c.randomBytes(32);const h=c.argon2Sync("argon2id",{message:process.argv[1],nonce:s,memory:65536,passes:3,parallelism:4,tagLength:64});console.log("argon2id$65536$3$4$"+s.toString("base64")+"$"+h.toString("base64"));' "yourpassword"
> ```
>
> Drydock v1.6 acepta solo hash de autenticación básica argon2id. Se rechazan los hashes heredados `{SHA}`, `$apr1$`/`$1$`, `crypt` y de texto sin formato; regenerarlos antes de actualizar.
> La autenticación es **requerida de forma predeterminada**. Consulte los [auth docs](https://getdrydock.com/docs/configuration/authentications) para OIDC, acceso anónimo y otras opciones.
> El acceso anónimo debe confirmarse explícitamente con `DD_ANONYMOUS_AUTH_CONFIRM=true` tanto en instalaciones nuevas como actualizadas. Sin esa confirmación, una instancia sin autenticación configurada o con autenticación anónima no confirmada se inicia cerrada de forma segura: las solicitudes protegidas de la API devuelven `401`, las rutas públicas de descubrimiento y estado de autenticación siguen disponibles y `/health` devuelve `503`.

La imagen incluye archivos binarios `trivy` y `cosign` para escaneo de vulnerabilidades locales y verificación de imágenes.

Consulte la [guía de inicio rápido](https://getdrydock.com/docs/quickstart) para Docker Compose, seguridad de socket, proxy inverso y registros alternativos.

<hr>

<h2 align="center" id="recent-updates">Actualizaciones recientes</h2>

<details open>
<summary><strong>Aspectos destacados de v1.7.0-rc.10</strong></summary>

- **Los envíos por lotes y por resumen con `once=true` ahora toman la misma reserva de la ranura de notificación que toma la ruta simple, de modo que un escaneo manual superpuesto a un escaneo de cron ya no puede anunciar la misma actualización dos veces.** El vaciado del resumen omite y descarta un resultado en búfer que un vaciado anterior ya envió, y el búfer de reintentos por lotes ya no lleva al activador una entrada sin reservar. ([#998](https://github.com/CodesWhat/drydock/pull/998))
- **Dar de baja un watcher ahora borra el temporizador de plazo del escaneo de cron**, de modo que un watcher ya desmontado no registra una advertencia de plazo que ya no le corresponde, cada llamador que esperaba ese escaneo se resuelve y un escaneo solicitado tras el desmontaje se rechaza en lugar de iniciarse. ([#998](https://github.com/CodesWhat/drydock/pull/998))
- **La guía de inicio ahora indica que los scripts de hook se ejecutan dentro del contenedor de Drydock**, de modo que una ruta que solo existe en el host o en el contenedor actualizado falla, y la corrección de búsqueda de registro del agente ahora acredita a quien la escribió. ([#996](https://github.com/CodesWhat/drydock/pull/996))
- **El mismo párrafo de hooks ahora indica que un pre-hook fallido aborta la actualización de forma predeterminada y nombra `dd.hook.pre.abort=false` como la opción para desactivarlo**, en lugar de describir el aborto como incondicional. ([#1001](https://github.com/CodesWhat/drydock/pull/1001))

Notas completas de la versión en [CHANGELOG.md](./CHANGELOG.md#170-rc10--2026-09-04).

</details>

<details open>
<summary><strong>Aspectos destacados de v1.7.0-rc.9</strong></summary>

- **`watchFromCron()` ahora es de ejecución única, de modo que los escaneos superpuestos en una flota grande ya no disparan el mismo activador varias veces para la misma actualización.** Un escaneo que nunca finaliza ahora compite contra un plazo límite para que no pueda bloquear los siguientes ciclos de cron. ([#979](https://github.com/CodesWhat/drydock/pull/979))
- **Un activador `once=true` ya no se dispara de nuevo horas después para una actualización de etiqueta que ya había anunciado, cuando un registro limita la tasa de la consulta de digest**, porque la clave del historial de notificaciones ahora es estable ante ese fallo en lugar de alternar entre dos formatos de hash. ([#979](https://github.com/CodesWhat/drydock/pull/979))
- **Los banners de obsolescencia de la interfaz para las variables de entorno `DD_TRIGGER_*` eliminadas y la anulación del healthcheck basada en curl ahora indican que esas cosas ya desaparecieron**, en lugar de señalar una fecha límite de eliminación que ya pasó. ([#988](https://github.com/CodesWhat/drydock/pull/988))
- **Una auditoría de documentación corrigió el README, DEPRECATIONS.md y la documentación de configuración/activadores/registros/API/monitoreo/agentes frente al código real de este árbol**, y los fragmentos de Get Started del sitio de marketing ahora despliegan una instancia que realmente queda saludable. ([#988](https://github.com/CodesWhat/drydock/pull/988))

Notas completas de la versión en [CHANGELOG.md](./CHANGELOG.md#170-rc9--2026-09-03).

</details>

<details open>
<summary><strong>Aspectos destacados de v1.7.0-rc.8</strong></summary>

- **Las rutas de actualización nativa de Docker y de Compose ahora fijan un digest inmutable de la imagen extraída antes de la verificación de firma, el escaneo y el reemplazo**, cerrando la ventana de reetiquetado de registro en ambas rutas. ([#961](https://github.com/CodesWhat/drydock/pull/961), [#952](https://github.com/CodesWhat/drydock/pull/952))
- **La autoactualización ya no revierte un reemplazo verificado por salud cuando falla la limpieza del contenedor antiguo**, y el manejador de instantáneas del watcher deja de tratar una lista de contenedores vacía como una eliminación masiva. ([#951](https://github.com/CodesWhat/drydock/pull/951), [#929](https://github.com/CodesWhat/drydock/pull/929))
- **`dd.registry.lookup.image` ahora se aplica a los contenedores reportados por agentes de transporte Docker del controlador**, de modo que los contenedores reportados por Portwing respetan la misma anulación de registro que los observados localmente. ([#956](https://github.com/CodesWhat/drydock/pull/956))
- **`DD_AGENT_ALLOW_INSECURE_SECRET` ya no crea un agente fantasma llamado `allow`**, y un contenedor marcado como `unknown` antes de configurar su registro ahora se recupera al actualizar. ([#954](https://github.com/CodesWhat/drydock/pull/954), [#955](https://github.com/CodesWhat/drydock/pull/955))
- **Los volcados de depuración redactan las URL de servicio de Apprise, los ID de usuario de Rocket.Chat y los ID de chat de Telegram**, cerrando el último hueco de credenciales específico de proveedor en ese endpoint. ([#953](https://github.com/CodesWhat/drydock/pull/953))
- **Llegan cuatro correcciones del barrido de control de calidad de rc.6**: un aviso de Trivy corregido, una página 404 real, recuentos de búsqueda de auditoría precisos y un panel de servidores que respeta su propio botón Actualizar. ([#928](https://github.com/CodesWhat/drydock/pull/928))

Notas completas de la versión en [CHANGELOG.md](./CHANGELOG.md#170-rc8--2026-09-03).

</details>

<details open>
<summary><strong>Aspectos destacados de v1.7.0-rc.7</strong></summary>

- **La paginación de los registros sigue ahora el cursor de cada registro**, evitando saltos de páginas o finales prematuros. ([#927](https://github.com/CodesWhat/drydock/pull/927))
- **Las actualizaciones siguen siendo exitosas cuando falla la limpieza después de la comprobación de salud**; las cargas SSE son menores y las autoactualizaciones esperan a que terminen los ciclos activos antes de tomar el bloqueo exclusivo. ([#931](https://github.com/CodesWhat/drydock/pull/931), [#942](https://github.com/CodesWhat/drydock/pull/942))
- **La redacción de credenciales cubre ahora activadores, registros, volcados de depuración y hosts parecidos**, evitando registrar o enviar secretos a hosts de registro controlados por atacantes. ([#932](https://github.com/CodesWhat/drydock/pull/932))
- **Las reescrituras de Compose verifican el repositorio en ejecución antes de escribir**; la poda de agentes y los fallos de reversión quedan cubiertos de forma segura. ([#933](https://github.com/CodesWhat/drydock/pull/933))
- **Las solicitudes autenticadas por cabecera ya no persisten sesiones**, por lo que el sondeo Basic Auth no hace crecer el almacén de sesiones. ([#935](https://github.com/CodesWhat/drydock/pull/935))
- **La comparación de competidores y la hoja de ruta se actualizaron para 2026**, manteniendo vigente la documentación de la versión. ([#936](https://github.com/CodesWhat/drydock/pull/936))

Notas completas de la versión en [CHANGELOG.md](./CHANGELOG.md#170-rc7--2026-08-29).

</details>

<details open>
<summary><strong>Aspectos destacados de v1.7.0-rc.6</strong></summary>

- **Se cierran dos brechas más en la propiedad de contenedores de los agentes, además de la corrección anterior de #904**: un id de contenedor completamente nuevo no tenía ninguna comprobación de propiedad, lo que permitía a un agente reclamar un nombre de watcher que pertenece al propio controlador; y las rutas de ingestión masiva (el handshake, el resguardo de instantánea del watcher, el `watch`/`watchContainer` bajo demanda, y el `handleContainerSync` de borde) llegaban a `processAuthoritativeContainer` sin ninguna comprobación intermedia, de modo que un agente todavía podía reclamar el contenedor de otro agente o del propio controlador en su siguiente instantánea rutinaria. Ambas rutas ahora aplican las mismas comprobaciones de propiedad que añadió la corrección original.
- **Se refuerzan la autenticación de pull de registries, las fugas en las respuestas de error y el enmascarado de errores de vista previa**: trece registries (Hub, Custom, DHI, DOCR, Harbor, Gitea, Forgejo, Codeberg, Nexus, Artifactory, Alibaba CR, OCIR, IBM CR) se autenticaban para la comprobación de versión y luego hacían el pull de forma anónima, porque el constructor de credenciales de pull no tenía ninguna rama para un valor `auth` configurado; ahora decodifica ese valor igual que ya lo hacía el constructor de credenciales de búsqueda, y un valor malformado falla de forma cerrada en lugar de devolver nada silenciosamente. Ocho manejadores de la API dejaron de interpolar un mensaje de excepción crudo -que podía contener una cabecera `Authorization` o una URL de webhook con credenciales- en una respuesta 500, y ahora lo enrutan a través del depurador `sanitizePreviewErrorReason` ya existente, que ahora también redacta credenciales incrustadas en un segmento de la ruta de una URL (URLs de webhook de Telegram, IFTTT y Discord), no solo en cabeceras o en la información de usuario.
- **La validación de parámetros de consulta ahora es consistente en los endpoints de log, agent y audit**: un `tail` o `since` no numérico antes ponía `NaN` en la lectura del búfer circular en lugar de ser rechazado, un `?tail=` vacío se interpretaba como ausente en lugar de inválido, y un `limit`/`offset` con un prefijo numérico como `?limit=25logs` se validaba por sus dígitos iniciales en lugar de fallar; los tres ahora rechazan cualquier valor que no sea un entero limpio y completo.
- **Se corrigen seis defectos de la interfaz**: la selección de fila nunca se resaltaba realmente en siete vistas, porque la tabla de datos compartida declara `selectedKey`, pero cada vista le pasaba `active-row` en su lugar; el texto blanco con un contraste de hasta 1.37:1 en el botón de prueba de triggers y en dos avatares se unifica a un token que alcanza 4.5:1 en los doce temas; la bandeja de salida de notificaciones y la vista de detalle a pantalla completa de un contenedor tenían cada una su propia condición de carrera en la que la vista se renderizaba antes de que sus datos se resolvieran, ambas ya están protegidas; dos watchers del dashboard se perdían cada actualización SSE in situ porque observaban una ref simple en lugar de una fuente consciente de la longitud o de la huella por fila; y el texto de estado que se mostraba como valores de enum en inglés crudo en cinco lugares ahora está traducido en los 16 idiomas.
- **2109 cadenas que todavía mostraban el texto fuente en inglés ahora están realmente traducidas**, en los 16 idiomas no ingleses: gran parte de la lista de contenedores, los diálogos de actualización y reversión, la paleta de búsqueda y la bandeja de salida de notificaciones habían caído silenciosamente al inglés sin importar el idioma seleccionado. El flujo de sincronización semanal de Crowdin tampoco vuelve a revertir al inglés los seis READMEs traducidos: `README.md` ya no está registrado como fuente de Crowdin, y los READMEs traducidos ahora se mantienen escritos a mano en el repositorio y se verifican frase por frase en cada corte de versión. ([#919](https://github.com/CodesWhat/drydock/pull/919))
- **Correcciones de fiabilidad de release y CI**: la compilación de humo multiarquitectura ahora reintenta ante una condición de carrera abierta en BuildKit (moby/buildkit#7089) que podía anteponer dos veces la ruta del emulador QEMU y hacer fallar por completo una compilación multiarquitectura, y el propio corte de release obtiene un reintento de compilación completo para el caso en que el primer intento no produjera ningún digest; el escaneo semanal de DAST, que nunca había llegado a completarse porque ZAP por sí solo consumía 39m46s del presupuesto de 40 minutos y dejaba sin recursos a Nuclei, ahora ejecuta ambos escáneres como trabajos paralelos independientes; y la búsqueda de la documentación, que antes devolvía alrededor de 1600 resultados repartidos en cinco versiones archivadas con el changelog más antiguo en primer lugar, ahora se limita a la versión que se está leyendo.

Notas completas en [CHANGELOG.md](./CHANGELOG.md#170-rc6--2026-08-29).

</details>

<details>
<summary><strong>Aspectos destacados de v1.7.0-rc.5</strong></summary>

- **Un endurecimiento de seguridad corrige cinco hallazgos en Portwing y en la superficie de depuración/diagnóstico**: una carga hello de Portwing malformada ahora se valida antes de analizarla, en lugar de lanzar una excepción fuera del límite de errores del callback; la propiedad de los contenedores del agente ahora se aplica en el límite de actualización/eliminación; el proceso de ocultación ahora detecta también los valores `*_PAT` y las credenciales incrustadas en URLs (incluidas las relativas al esquema); y la ruta de diagnóstico de origen rechazado está ahora limitada en tasa. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **Los temas oscuros cumplen ahora el contraste mínimo WCAG 2.2**: el texto secundario/atenuado, los colores de tono, las superficies de las notificaciones toast y las etiquetas de los botones primarios se elevan para alcanzar 4,5:1 frente a las superficies sobre las que realmente se pintan, en los seis temas oscuros. ([#850](https://github.com/CodesWhat/drydock/issues/850), [#865](https://github.com/CodesWhat/drydock/discussions/865))
- **Las flotas grandes y los clientes lentos ya no rompen la conexión con el controlador**: un agente cuya repetición de watcher en caché superaba los 256 KiB nunca podía reconectarse; ahora se soluciona manteniendo el flujo abierto para que el handshake autenticado aporte el estado; los clientes SSE que se retrasan reciben ahora una entrega acotada, consciente del drenaje y en orden, en lugar de escrituras descartadas o de memoria ilimitada; el limitador del log del sistema ya no recurre a una identidad vacía; y un transporte de agente no compatible ahora se rechaza en la admisión en lugar de fallar más tarde. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **El estado del ciclo de vida de actualizaciones y watchers se mantiene preciso durante reinicios y desmontajes**: la recuperación de arranque ya no marca como actualizado un contenedor que no cambió, un reinicio ya no suprime los eventos de finalización de lote para actualizaciones aún en curso, una actualización que nunca llegó a iniciarse ya no se informa como fallida, un watcher desmontado a mitad de su configuración ya no puede resucitar por una devolución de llamada tardía, y los fragmentos de eventos de Docker analizados de forma concurrente ya no compiten por un búfer compartido. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **Correcciones de corrección de datos en copias de seguridad, reversiones y listas de contenedores**: las copias de seguridad ahora llevan una identidad estable y delimitada en lugar de colisionar por un nombre de contenedor compartido; una reversión restaura ahora el digest registrado con la copia de seguridad en lugar de lo que una etiqueta mutable señale en ese momento; los escaneos de digest concurrentes ya no se cancelan entre sí; una acción de contenedor exitosa ya no devuelve 500 cuando falla la actualización posterior; y las listas de contenedores paginadas ahora se ordenan de forma global en lugar de solo dentro de cada página. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **El flujo de trabajo de sincronización de Crowdin ya no falla en ramas dev que no son la predeterminada**: un push a una rama `dev/vX.Y` que no era la más reciente terminaba en un conflicto de checkout porque el resolutor de base siempre elegía la rama dev más alta sin importar qué referencia había disparado la ejecución; ahora un push apunta directamente a su propia rama. ([run 33047712284](https://github.com/CodesWhat/drydock/actions/runs/33047712284))

Notas completas en [CHANGELOG.md](./CHANGELOG.md#170-rc5--2026-08-27).

</details>

<details>
<summary><strong>Aspectos destacados de v1.7.0-rc.4</strong></summary>

- **Los flujos de logs por WebSocket funcionan ahora detrás de proxies con terminación TLS**: con el proxy de confianza habilitado y sin `X-Forwarded-Proto` en la solicitud de upgrade, la comprobación de origen ya no recurre al estado TLS del socket local (HTTP simple detrás de la terminación TLS, lo que provocaba que cada conexión del navegador recibiera un 403); el protocolo se trata ahora como desconocido y la validación de host no cambia. Traefik reenvía el esquema orientado al cliente del upgrade como `wss` en lugar de `https` (traefik/traefik#6388), lo que la comprobación de origen rechazaba de plano, de modo que la primera corrección por sí sola seguía devolviendo 403 detrás de una configuración predeterminada de Traefik; `ws` y `wss` ahora se mapean a `http:`/`https:` para la comparación de origen. ([#867](https://github.com/CodesWhat/drydock/issues/867), [#868](https://github.com/CodesWhat/drydock/pull/868), [#887](https://github.com/CodesWhat/drydock/pull/887))
- **El arranque ya no falla cuando el volumen del store rechaza `chmod`**: el endurecimiento de permisos de 1.6.0 lanzaba una excepción ante `EPERM`, de modo que los montajes que rechazan `chmod` (volúmenes NFS/CIFS, contenedores sin root) tumbaban todo el proceso al arrancar y bloqueaban por completo las actualizaciones desde 1.6.0; ahora se limita a avisar y continuar ante `EPERM`/`EACCES`/`ENOTSUP`; un volumen realmente de solo lectura (`EROFS`) sigue fallando rápido al arrancar, porque de todas formas no se podría persistir nada allí. ([#874](https://github.com/CodesWhat/drydock/discussions/874), [#886](https://github.com/CodesWhat/drydock/pull/886))
- **El volcado de depuración ocultaba los nombres de las variables de entorno en lugar de los valores**: las entradas de entorno son pares `{key, value}`, y el recorrido de redacción comparaba el nombre literal de la propiedad `key` con su regla de tokens sensibles, de modo que una variable como `HF_TOKEN` aparecía con el nombre oculto y el secreto en texto plano; ahora los nombres permanecen visibles y los valores se ocultan cuando el nombre coincide con una regla sensible. ([#875](https://github.com/CodesWhat/drydock/issues/875), [#885](https://github.com/CodesWhat/drydock/pull/885))
- **Las etiquetas de enteros simples ya no superan a las versiones con puntos**: una etiqueta de contador de compilación como `168` ya no se convierte en un falso `168.0.0` que supera a una versión real como `1.43.3`, tanto en el badge de etiqueta sugerida como en la ruta de recuperación accionable `includeTags`, que ahora comparten una única regla de partición para no volver a divergir. ([#859](https://github.com/CodesWhat/drydock/issues/859), [#871](https://github.com/CodesWhat/drydock/pull/871))
- **Las imágenes base eliminan seis CVE HIGH de OpenSSL**: los pines de digest de `node:24-alpine` y `alpine:3.24`, y el pin de apk de `openssl`, avanzan a OpenSSL 3.5.8-r0. ([#881](https://github.com/CodesWhat/drydock/pull/881))
- **El sitio de demostración envía el conjunto completo de cabeceras de seguridad**: las cabeceras que DAST marcaba como ausentes en la superficie de demostración ahora se envían. ([#878](https://github.com/CodesWhat/drydock/pull/878))
- **Los contenedores que salen del alcance de vigilancia se eliminan del store y de la interfaz**: un contenedor excluido porque `watchbydefault` está desactivado, o porque se le quitó la etiqueta `dd.watch`, conservaba un registro obsoleto mientras siguiera pudiendo inspeccionarse en Docker; los contenedores detenidos pero aún vigilados mantienen su comportamiento habitual del botón de inicio. ([#869](https://github.com/CodesWhat/drydock/issues/869), [#888](https://github.com/CodesWhat/drydock/pull/888))

Notas completas en [CHANGELOG.md](./CHANGELOG.md#170-rc4--2026-08-26).

</details>

<details>
<summary><strong>Aspectos destacados de v1.7.0-rc.3</strong></summary>

- **Los túneles de borde de Portwing ahora transportan cuerpos que no son JSON**: el frame de bienvenida del controlador ahora anuncia la capacidad `edge-response-body-b64` y decodifica cuerpos de respuesta de Docker negociados en base64 (por ejemplo, la respuesta de texto plano «OK» de `_ping`) de los agentes que la admiten; aditivo y controlado por capacidad. ([#852](https://github.com/CodesWhat/drydock/pull/852))
- **Los badges del README ahora se leen en vivo**: los badges de versión, licencia, descargas y estrellas ahora se renderizan desde endpoints en vivo de shields.io en lugar de imágenes estáticas, y el gráfico de historial de estrellas se presenta ahora como un par claro/oscuro con el tema correspondiente que se regenera en el corte de la versión en lugar de por cron. ([#851](https://github.com/CodesWhat/drydock/pull/851), [#844](https://github.com/CodesWhat/drydock/pull/844), [#847](https://github.com/CodesWhat/drydock/pull/847))
- **Las puertas de DAST y de lint de flujos de trabajo ahora fallan de forma cerrada**: los escaneos de ZAP ya no ignoran todas las advertencias, y el paso de zizmor en pre-push falla con una sugerencia de instalación en lugar de omitirse silenciosamente cuando falta el binario. ([#842](https://github.com/CodesWhat/drydock/pull/842))
- **Un monitor diario verifica que `main` lleve una etiqueta de versión**: un flujo de trabajo programado y de solo lectura se pone en rojo si el HEAD de `main` no tiene etiqueta. ([#846](https://github.com/CodesWhat/drydock/pull/846))
- **Correcciones en el pipeline de versiones**: se corrige la ruptura de CI del corte rc.2: se revierte una sobreescritura de js-yaml que rompía las pruebas de carga de Artillery, y dos esperas de Playwright se amplían más allá de los presupuestos propios de operación de la app. ([#829](https://github.com/CodesWhat/drydock/pull/829), [#836](https://github.com/CodesWhat/drydock/pull/836))

Notas completas en [CHANGELOG.md](./CHANGELOG.md#170-rc3--2026-08-23).

</details>

<details>
<summary><strong>Aspectos destacados de v1.7.0-rc.2</strong></summary>

- **Resolución de política de acción por contenedor**: la API y la interfaz ahora muestran el estado resuelto (blocked/manual/auto) y el disparador ganador de cada contenedor, además de una nueva etiqueta `dd.action.auto` y el modo `AUTO=onauto` para acceso solo manual sin despacho automático.
- **Cambios incompatibles en este ciclo**: `DD_TRIGGER_*`/`dd.trigger.*` se eliminan por completo, `trigger-excluded`/`trigger-not-included` pasan a ser bloqueos duros de actualización, el esquema de temas MQTT de Home Assistant añade un segmento `agent/<name>` por defecto, `GET /api/auth/methods` devuelve 410, y `curl` desaparece de la imagen.
- **Correcciones de exactitud en la comprobación de actualizaciones**: un error de registro durante la comprobación ya no informa «Up to date», un contenedor con errores ya no anula toda la sincronización del inventario del agente, y los índices de imagen OCI anidados ahora se resuelven al manifiesto real. ([#814](https://github.com/CodesWhat/drydock/issues/814))
- **Correcciones de dependencias y autoactualización**: un miembro de dependencia rechazado conserva su contexto de reinicio, las actualizaciones de Compose ya no arrastran valores de entorno obsoletos heredados de la imagen, y las anulaciones de política de actualización ahora sobreviven a la autoactualización de drydock. ([#718](https://github.com/CodesWhat/drydock/pull/718), [#736](https://github.com/CodesWhat/drydock/pull/736), [#743](https://github.com/CodesWhat/drydock/pull/743))
- **Seguridad**: se cerró una vía de inyección de propiedades remota en la sincronización de consultas de URL de la lista de contenedores, y se acotó la puerta de Grype para la imagen en torno a un CVE de Alpine pendiente de corrección. ([#750](https://github.com/CodesWhat/drydock/pull/750))

Notas completas en [CHANGELOG.md](./CHANGELOG.md#170-rc2--2026-08-20).

</details>

<details>
<summary><strong>Aspectos destacados de v1.7.0-rc.1</strong></summary>

- **Actualizaciones conscientes de dependencias**: las etiquetas o los metadatos de Compose crean un grafo de dependencias validado, muestran las oleadas exactas en la vista previa y ejecutan actualizaciones o reinicios de dependientes en orden determinista, con manejo seguro de ciclos, fallos y vistas previas obsoletas. ([Discusión #219](https://github.com/CodesWhat/drydock/discussions/219))
- **Experiencia del operador**: PWA instalable, enlaces de puertos con nombre, tiempo de actividad del contenedor en vivo, atajos de teclado y detección con espera para contenedores recién descubiertos.
- **Migración incompatible de disparadores**: `DD_TRIGGER_*` ahora impide el arranque y las etiquetas antiguas `dd.trigger.include` / `dd.trigger.exclude` ya no enrutan trabajo; use `DD_ACTION_*`, `DD_NOTIFICATION_*` y sus etiquetas con ámbito.
- **Refuerzo de seguridad y ciclo de vida**: la autenticación, las solicitudes de agentes, los registros, WebSockets y las solicitudes a registros tienen límites explícitos; se ocultan valores sensibles de comandos y hooks; el descubrimiento de Home Assistant se resincroniza después del arranque y retira trabajo de proveedores sin publicaciones obsoletas. ([#708](https://github.com/CodesWhat/drydock/issues/708))

Notas completas en [CHANGELOG.md](./CHANGELOG.md#170-rc1--2026-08-14).

</details>

<details>
<summary><strong>Aspectos destacados de v1.6.0</strong></summary>

- **El transporte de agentes/Edge de Portwing madura**: comprobaciones y actualizaciones nativas de Docker controladas por el controlador para Portwing 0.9.0+, transmisión continua de registros Edge, firma de solicitudes Ed25519 (v2) y nombres visibles propiedad del agente vinculados a su clave. ([#632](https://github.com/CodesWhat/drydock/issues/632), [#637](https://github.com/CodesWhat/drydock/issues/637))
- **Política de actualización declarativa con estabilización de madurez**: precedencia `dd.updatePolicy.*` de tres niveles, cuenta atrás en vivo hasta liberar un candidato retenido y una notificación `maturity-cleared` dedicada. ([Discusión #307](https://github.com/CodesWhat/drydock/discussions/307), [Discusión #406](https://github.com/CodesWhat/drydock/discussions/406))
- **Plantillas por regla, preferencias de campana y el nuevo evento `container-unhealthy`**, además de MQTT bidireccional de Home Assistant, cuyo botón Instalar ejecuta una actualización real. ([Discusión #205](https://github.com/CodesWhat/drydock/discussions/205), [Discusión #198](https://github.com/CodesWhat/drydock/discussions/198))
- **Todas las vistas de listas principales son adaptables**: una `DataTable` compartida con selector persistente tabla/tarjeta en las diez vistas, que cambia a tarjetas por debajo de unos 640 px. ([#498](https://github.com/CodesWhat/drydock/issues/498))
- **Se completa la paridad de `/api/v1`**: se eliminan el alias sin versión `/api/*` y `WS /api/log/stream` (`410 Gone`); un shim opcional `DD_COMPAT_WUDCARD` cubre wud-card/Homepage. ([Discusión #469](https://github.com/CodesWhat/drydock/discussions/469))
- **Refuerzo de seguridad**: el acceso anónimo se cierra de forma segura también al actualizar, los activadores HTTP están protegidos frente a SSRF, WebSocket valida el origen completo y la cookie de sesión pasa a llamarse `drydock.sid`.

Notas completas en [CHANGELOG.md](./CHANGELOG.md#160--2026-08-11).

</details>

<details>
<summary><strong>Aspectos destacados de v1.6.0-rc.13</strong></summary>

- **La comparación de digest parte de candidatos del mismo repositorio**: `getOrderedRepoDigests` filtra `RepoDigests` por el repositorio de la imagen en vez de confiar en el primer elemento; un ancla obsoleta ya guardada se repara sola. ([#670](https://github.com/CodesWhat/drydock/pull/670))
- **`nanoid` fijado en 3.3.18** en todos los espacios de trabajo para CVE-2026-67213 y, en e2e, CVE-2026-67214. ([#673](https://github.com/CodesWhat/drydock/pull/673))
- **El gráfico Star History se aloja localmente**: una ruta del mismo origen `/api/star-history` reemplaza la integración de terceros, con caché en el borde y un SVG alternativo si falla la consulta. ([#672](https://github.com/CodesWhat/drydock/pull/672))
- **Actualización de CVE en imágenes base**: `node:24-alpine` usa Node 24.19.0 y la etapa de compilación de `aquasec/trivy` usa 0.73.0, eliminando CVE HIGH/MEDIUM. ([#682](https://github.com/CodesWhat/drydock/pull/682))
- **Resolución de alias del paquete de iconos**: el extractor sigue cadenas de alias de Iconify e incorpora Font Awesome Brands; una prueba fija todos los iconos utilizados en el paquete. ([#683](https://github.com/CodesWhat/drydock/pull/683))

</details>

<details>
<summary><strong>Aspectos destacados de v1.6.0-rc.12</strong></summary>

- **Renovación de dependencias de seguridad**: `brace-expansion` 5.0.9, `ip-address` 10.3.1 y `fast-uri` 4.1.2 corrigen sus CVE asociadas. ([#659](https://github.com/CodesWhat/drydock/pull/659))
- **Reloj de madurez**: el distintivo hot/mature resuelve primero `updatePolicy.maturityMinAgeDays` por contenedor y luego el umbral global, igual que el bloqueo; los fallos de fecha de publicación se registran con `warn` en vez de `debug`. ([#604](https://github.com/CodesWhat/drydock/issues/604))
- **Período de gracia al registrar agentes**: los bloqueos transitorios `agent-mismatch`/`no-update-trigger-configured` se suavizan en las vistas mientras se registran los componentes; la admisión sigue cerrada. ([#605](https://github.com/CodesWhat/drydock/issues/605))
- **Registros WS y autenticación anónima**: las actualizaciones WebSocket de registros aceptan sesiones cuando la autenticación anónima es el modo registrado. ([#636](https://github.com/CodesWhat/drydock/issues/636))
- **Respuestas 501 explícitas**: las acciones de ciclo de vida en agentes sin transporte Docker del controlador devuelven 501 con la causa en vez de un 404 ambiguo. ([#637](https://github.com/CodesWhat/drydock/issues/637))

</details>

<details>
<summary><strong>Aspectos destacados de v1.6.0-rc.11</strong></summary>

- **Transporte Portwing**: las marcas exactas `transport=docker-api`, `execution=controller`, `events=portwing` de Portwing 0.9.0 enrutan comprobaciones nativas, actualizaciones individuales/por lotes, acciones de ciclo de vida, vistas previas y restauraciones mediante Standard HTTP autenticado o Edge. Portwing sigue siendo la fuente de eventos y el inventario sin procesar no puede borrar resultados del controlador. ([#632](https://github.com/CodesWhat/drydock/issues/632), [#637](https://github.com/CodesWhat/drydock/issues/637), [Portwing #76](https://github.com/CodesWhat/portwing/issues/76))
- **Notificaciones**: plantillas de cuerpo y título por regla/por proveedor con vista previa en vivo, además de categorías de campana en la aplicación respaldadas por auditorías y umbrales de gravedad de actualización.
- **Panel**: reemplazo de cuadrícula CSS sin dependencia con reordenamiento táctil/ratón, cambio de tamaño limitado, diseños responsivos, visibilidad de widgets, restablecimiento y sincronización opcional de preferencias entre dispositivos.
- **Política de actualización**: precedencia declarativa de observador/etiqueta/UI, anulación/reversión de seguimiento de auditoría, cuenta regresiva de madurez/anulación manual y visibilidad informativa de etiquetas fijadas con una vista de etiquetas actual → más nueva apilada.
- **Recursos del contenedor**: la columna Recursos sigue visible de forma predeterminada, pero puede ocultarse de manera persistente; los accesos a fuente, notas de versión y registro permanecen en el menú Más y en los pies de tarjeta.
- **Rendimiento y recuperación**: deduplicación de listas de etiquetas por encuesta, proyecciones agregadas más ligeras, historiales de registros grandes virtualizados, transferencia de registros en vivo inmutable, tiempo de espera de arranque de autenticación, migraciones de preferencias completas y autocuración de fragmentos obsoletos.
- **Se aplicaron migraciones v1.6**: los alias de entorno/etiqueta WUD, los formatos de autenticación heredados, los conmutadores de vigilancia obsoletos, los alias de plantilla, Kafka `clientId` y las configuraciones públicas de Hub/DHI de solo token con formato incorrecto ya no se ejecutan. Los alias de taxonomía de activación permanecen hasta una publicación final de advertencia de nivel de error.

Guía completa de migración en [DEPRECATIONS.md](./DEPRECATIONS.md).

</details>

<details>
<summary><strong>Aspectos destacados de v1.5.2</strong></summary>

- **Política de actualización segura para la recreación**: las puertas de madurez, las etiquetas/resúmenes omitidos y las posposiciones ahora sobreviven a la recreación de contenedores para cargas de trabajo de agentes locales y remotos.
- **Confiabilidad de etiquetas fijadas**: las etiquetas completamente fijadas detectan reconstrucciones de resúmenes de la misma etiqueta nuevamente, mientras que la interfaz de usuario puede mostrar una etiqueta de la misma familia más nueva y no procesable sin cambiar el comportamiento de actualización o activación.
- **Recuperación de reversión**: la creación de reemplazo, la conexión de red o el inicio fallidos ahora limpian el candidato antes de restaurar el contenedor original, y las fallas repetidas no pueden ocurrir en cascada a través de cambios de nombre de reversión anidados.
- **Recreación de contenedores más segura**: las direcciones MAC asignadas por Daemon ya no se fijan en los reemplazos, mientras que las direcciones MAC de la red primaria configuradas explícitamente permanecen conservadas.
- **Encuesta de imágenes locales más silenciosa**: las imágenes creadas o cargadas localmente sin resumen de registro omiten búsquedas remotas en lugar de generar errores de autorización recurrentes.

Historial completo en [CHANGELOG.md](./CHANGELOG.md).

</details>

<hr>

<h2 align="center" id="screenshots">Capturas de pantalla y demostración en vivo</h2>

<p align="center">
  <img src="docs/assets/drydock-demo.gif" alt="Drydock detecting and applying a container update" width="880">
</p>

<p align="center"><em>Detecte una actualización, vea exactamente qué cambios y aplíquela. Se manejan copias de seguridad, verificación de estado y reversión.</em></p>

<table>
<tbody><tr>
<td width="50%" align="center"><strong>Luz</strong></td>
<td width="50%" align="center"><strong>oscuro</strong></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-dashboard-light.png" alt="Dashboard Light"></td>
<td><img src="docs/assets/drydock-dashboard-dark.png" alt="Dashboard Dark"></td>
</tr>
</tbody></table>

<div align="center">

**¿Por qué mirar capturas de pantalla cuando puedes experimentarlo tú mismo?**

<a href="https://demo.getdrydock.com"><img src="https://img.shields.io/badge/Try_the_Live_Demo-4f46e5?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSI2IDMgMjAgMTIgNiAyMSA2IDMiLz48L3N2Zz4=&logoColor=white" alt="Try the Live Demo" height="36"></a>

Totalmente interactivo: interfaz de usuario real, datos simulados, no requiere instalación. Se ejecuta completamente en el navegador.

</div>

<hr>

<h2 align="center" id="why-drydock">Por qué Drydock</h2>

Las imágenes de los contenedores quedan obsoletas silenciosamente. Una imagen base parchea un CVE, una aplicación corta una versión, una etiqueta se mueve. A menos que esté observando cada registro manualmente, sus contenedores en ejecución se retrasan hasta que algo se rompe o es explotado.

La mayoría de las herramientas obligan a hacer concesiones. Los actualizadores automáticos (Watchtower, Ouroboros) se activan y reinician con poca visibilidad o control, y ahora prácticamente no reciben mantenimiento. Los paneles (Portainer) administran contenedores pero no están diseñados para inteligencia de actualización. Drydock es **monitor primero**: observa 23 registros y le dice exactamente qué cambió (mayor, menor, parche o resumen) antes de que suceda algo, luego actúa solo cuando usted lo permite. Y va más allá que cualquiera de ellos. El escaneo de vulnerabilidades Trivy/Grype bloquea actualizaciones no seguras, cosign verifica firmas, las copias de seguridad de imágenes previas a la actualización se revierten automáticamente en caso de falla en la verificación de estado, los agentes distribuidos cubren hosts remotos y 20 integraciones de notificaciones y acciones cierran el ciclo. El ciclo de vida completo de la actualización, con una interfaz de usuario web y una API REST.

<hr>

<h2 align="center" id="features">Características</h2>

| | Característica | Descripción |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔭  | **Monitorizar primero la detección**                      | Observa cada contenedor en ejecución y clasifica cada actualización disponible como principal, menor, parche o resumen antes de que suceda algo. Nada cambia hasta que tú lo digas.                                                                                                                                                                                                                                                                                                                                                                                                                |
| 📦  | **23 proveedores de registro**                            | Docker Hub, GHCR, ECR, ACR, GCR, GAR, GitLab, Quay, Harbour, Artifactory, Nexus y 12 más. Público y privado, en la nube y autohospedado, con autenticación y TLS por registro.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 🔔  | **20 activadores**                                        | 17 canales de notificación (Slack, Discord, Telegram, Teams, SMTP, MQTT, ntfy y más) además de acciones de Docker, Docker Compose y Command, con plantillas por evento/proveedor, vista previa en vivo, filtrado de umbral y modo por lotes.                                                                                                                                                                                                                                                                                                                                                    |
| 🥊  | **Update Bouncer**                                        | El escaneo de vulnerabilidades Trivy/Grype bloquea las actualizaciones no seguras antes de que se implementen, con verificación de firma Cosign y generación de SBOM (CycloneDX y SPDX).                                                                                                                                                                                                                                                                                                                                                                                                        |
| ↩️  | **Copia de seguridad de imágenes y reversión automática** | Instantáneas de imágenes previas a la actualización con retención configurable, reversión automática en caso de falla en la verificación de estado y reversión manual con un solo clic desde la interfaz de usuario.                                                                                                                                                                                                                                                                                                                                                                                               |
| 🪝  | **Ganchos de ciclo de vida**                              | Comandos de shell previos y posteriores a la actualización a través de etiquetas de contenedor, con tiempos de espera por gancho y control de cancelación en caso de falla.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 🗂️ | **Actualizaciones Docker Compose**                        | Extraiga y vuelva a crear servicios de Compose a través de la API Docker Engine con parches de imágenes que preservan YAML.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 🎛️ | **Política por contenedor**                               | Las reglas de etiquetas Regex y el enrutamiento de activación utilizan etiquetas `dd.*`; Las puertas de madurez, saltar/posponer/fijar y las ventanas de mantenimiento se almacenan a través de UI/API o la configuración del observador.                                                                                                                                                                                                                                                                                                                                                                          |
| 🛰️ | **Agentes distribuidos**                                  | Supervise hosts Docker remotos mediante SSE. Los agentes Portwing 0.9.0+ funcionan por Standard HTTP entrante o transporte WebSocket Edge saliente; Drydock 1.6.0-rc.11+ puede ejecutar en el controlador comprobaciones nativas de registros y actualizaciones Docker individuales o por lotes a través de cualquiera de las rutas autenticadas. Edge también transporta registros continuos sin puerto de entrada; `DD_EXPERIMENTAL_PORTWING=false` sigue siendo la desactivación de emergencia. |
| 🖥️ | **Panel web**                                             | Interfaz de usuario de Vue 3 con una cuadrícula de widgets personalizable sin dependencia, vistas de tablas/tarjetas responsivas, actualizaciones SSE en vivo, controles de campana de notificación y detalles, registros y estadísticas por contenedor.                                                                                                                                                                                                                                                                                                                                                           |
| 🔗  | **API REST y webhooks**                                   | Puntos finales autenticados por token para activación de actualizaciones y vigilancia de CI/CD, además de ingesta de webhooks de registro firmados para eventos push.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 🔐  | **Autenticación OIDC**                                    | Asegure el tablero con OpenID Connect (Authelia, Auth0, Authentik). De forma predeterminada, todos los flujos de autenticación deniegan el acceso ante cualquier fallo (fail-closed).                                                                                                                                                                                                                                                                                                                                                                                              |
| 📈  | **Métricas Prometheus**                                   | Punto final `/metrics` incorporado con omisión de autenticación opcional para pilas de monitoreo Prometheus y Grafana.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 🌍  | **17 configuraciones regionales de UI**                   | Sistema de traducción completamente cableado con inglés completo y 16 configuraciones regionales mantenidas por la comunidad sincronizadas a través de Crowdin, conmutables en Config.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 🔒  | **Expresión regular inmune a ReDoS**                      | Cada patrón de etiquetas proporcionado por el usuario se compila a través de re2js (un puerto RE2 JS puro) para una coincidencia de tiempo lineal que no puede detenerse por un patrón de retroceso catastrófico.                                                                                                                                                                                                                                                                                                                                                                               |

<hr>

<h2 align="center" id="supported-integrations">Integraciones admitidas</h2>

### Registros (23)

Docker Hub · GHCR · ECR · ACR · GCR · GAR · GitLab · Quay · LSCR · Harbor · Artifactory · Nexus · Gitea · Forgejo · Codeberg · MAU · TrueForge · Personalizado · DOCR · DHI · IBM Cloud · Oracle Cloud · Alibaba Cloud

### Acciones (3)

Docker · Docker Compose · Comando

### Notificaciones (17)

Apprise · Discord · Google Chat · Gotify · HTTP · IFTTT · Kafka · Matrix · Mattermost · MQTT · MS Teams · NTFY · Pushover · Rocket.Chat · Slack · SMTP · Telegram

### Autenticación

Anónimo (suscripción a través de `DD_ANONYMOUS_AUTH_CONFIRM=true`) · Básico (nombre de usuario + hash de contraseña) · OIDC (Authelia, Auth0, Authentik). De forma predeterminada, todos los flujos de autenticación deniegan el acceso ante cualquier fallo (fail-closed).

### Update Bouncer

El escaneo de vulnerabilidades impulsado por Trivy o Grype bloquea las actualizaciones no seguras antes de que se implementen. Incluye verificación de firma Cosign y generación de SBOM (CycloneDX y SPDX).

<hr>

<h2 align="center" id="feature-comparison">Comparación de funciones</h2>

<details>
<summary><strong>¿Cómo se compara drydock con otras herramientas de actualización de contenedores?</strong></summary>

> ✅ = compatible &nbsp; ❌ = no compatible &nbsp; ⚠️ = parcial/limitado &nbsp; ? = sin confirmar &nbsp; † = archivado, ya no se mantiene

<h4 align="center">Gestores de actualizaciones</h4>

<table>
<thead>
<tr>
<th width="32%">Característica</th>
<th width="17%" align="center">drydock</th>
<th width="17%" align="center">WUD</th>
<th width="17%" align="center">Diun</th>
<th width="17%" align="center"><em>Watchtower&nbsp;†</em></th>
</tr>
</thead>
<tbody>
<tr><td>Mantenimiento activo</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>Interfaz web / panel</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Actualización automática de contenedores</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Actualizaciones de Docker Compose</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td></tr>
<tr><td>Actualizaciones compatibles con SemVer</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Monitorización de digest</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Filtrado por umbral de actualización (major/minor/patch/digest)</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Orden de actualización según dependencias</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Cola de aprobaciones pendientes</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Copia y reversión de imágenes</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Hooks del ciclo de vida (antes/después)</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Análisis de vulnerabilidades</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Registro de auditoría</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>RBAC / roles multiusuario</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Autenticación OIDC / SSO</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Canales de activación / notificación</td><td align="center">20</td><td align="center">17</td><td align="center">17</td><td align="center">~20</td></tr>
<tr><td>MQTT / Home Assistant</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Proveedores de registro</td><td align="center">23</td><td align="center">12</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>API REST</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>API de webhooks para CI/CD</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Métricas de Prometheus</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Agentes distribuidos (remotos)</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">⚠️</td></tr>
<tr><td>Agrupación de contenedores / stacks</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Iniciar/detener/reiniciar/actualizar contenedores</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Visor de registros del contenedor</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
</tbody>
</table>

> Watchtower se archivó en diciembre de 2025 y su última versión fue la v1.7.1 (noviembre de 2023). Un fork comunitario no oficial, nicholas-fedor/watchtower, sigue publicando versiones.

<h4 align="center">Plataformas de gestión</h4>

<table>
<thead>
<tr>
<th width="32%">Característica</th>
<th width="17%" align="center">drydock</th>
<th width="17%" align="center">Arcane</th>
<th width="17%" align="center">Komodo</th>
<th width="17%" align="center">Dockhand</th>
</tr>
</thead>
<tbody>
<tr><td>Mantenimiento activo</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Interfaz web / panel</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Actualización automática de contenedores</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Actualizaciones de Docker Compose</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Actualizaciones compatibles con SemVer</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Monitorización de digest</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Filtrado por umbral de actualización (major/minor/patch/digest)</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>Orden de actualización según dependencias</td><td align="center">⚠️</td><td align="center">✅</td><td align="center">✅</td><td align="center">?</td></tr>
<tr><td>Cola de aprobaciones pendientes</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Copia y reversión de imágenes</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Análisis de vulnerabilidades</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Registro de auditoría</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td></tr>
<tr><td>RBAC / roles multiusuario</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td></tr>
<tr><td>Autenticación OIDC / SSO</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Canales de activación / notificación</td><td align="center">20</td><td align="center">11+</td><td align="center">5</td><td align="center">15+</td></tr>
<tr><td>MQTT / Home Assistant</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Proveedores de registro</td><td align="center">23</td><td align="center">⚠️</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>Métricas de Prometheus</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Agentes distribuidos (remotos)</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Agrupación de contenedores / stacks</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">?</td></tr>
</tbody>
</table>

> Recopilado de la documentación y los repositorios públicos de cada proyecto, 29-08-2026.
> Se aceptan contribuciones si alguna información es inexacta.

</details>

<hr>

<h2 align="center" id="migration">Migración</h2>

<details>
<summary><strong>Migrando desde WUD (¿Qué pasa Docker?)</strong></summary>

Drydock v1.6 ya no carga variables de entorno `WUD_*` o etiquetas `wud.*` en tiempo de ejecución. Vuelva a escribirlos antes de iniciar el servicio actualizado; El estado persistente aún migra automáticamente. Utilice `docker exec -it drydock node dist/index.js config migrate --dry-run` para obtener una vista previa y luego `docker exec -it drydock node dist/index.js config migrate --file .env --file compose.yaml` para reescribir la configuración con los nombres `DD_*` y `dd.*`.

</details>

<hr>

<h2 align="center" id="roadmap">Hoja de ruta</h2>

<details>
<summary><strong>Temas y aspectos destacados de la versión</strong></summary>

Esta dirección cubre al menos los próximos doce meses, hasta agosto de 2027.
Solo temas generales; consulte [CHANGELOG.md](CHANGELOG.md) para conocer el detalle de cada versión.

| Versión                                      | Tema                                               | Aspectos destacados                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1.3.x** ✅ | Seguridad y Estabilidad                            | Escaneo Trivy, Update Bouncer, SBOM, 7 nuevos registros, 4 nuevos activadores, motor re2js regex                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **v1.4.x** ✅ | Modernización y refuerzo de la interfaz de usuario | Tailwind 4 + componentes personalizados, 6 temas, paleta Cmd/K, OpenAPI 3.1, actualizaciones YAML nativas de redacción, escaneo de doble ranura, refuerzo OIDC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **v1.5.0** ✅ | Observabilidad e i18n                              | división de taxonomía de activación (`DD_ACTION_*`/`DD_NOTIFICATION_*`), visor de registros WebSocket, personalización del panel, monitoreo de recursos, bandeja de salida de notificaciones + DLQ, resumen de escaneo de seguridad, 17 configuraciones regionales, reproducción de ID del último evento SSE, acceso telefónico al agente perimetral con autenticación Ed25519 (experimental, `DD_EXPERIMENTAL_PORTWING=true`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **v1.5.1** ✅ | Seguridad y mantenimiento                          | Corrección de autenticación de extracción GCR/GAR, finalización de TLS de registro (M-2), refuerzo de inyección de env-var de gancho, compatibilidad con `DD_SESSION_SECRET__FILE`, redacción de credenciales de volcado de depuración, verificación de permisos de archivos secretos, corrección de bloqueo de puerta de madurez, traducibilidad completa de la interfaz de usuario + traducciones de la comunidad, puerta de aplicación automática de ventana de mantenimiento, visualización del tiempo de actividad del contenedor, versión de software de superficie dividida de columna Etiqueta/Versión (etiqueta OCI, con escritura dual `dd.inspect.tag.path` + opción de enrutamiento `dd.inspect.tag.version-only`), opción de coincidencia de prefijo de montaje de composición, var de plantilla `${currentReleaseNotes}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **v1.5.2** ✅ | Política y confiabilidad de etiquetas fijadas      | Retención de política de madurez/omisión/posposición segura para recreación, detección de reconstrucción de resumen de etiquetas fijadas e información informativa de la misma familia, limpieza de candidatos de reversión, prevención de cascada de reversión, preservación de MAC explícito y comportamiento de omisión de registro de imágenes locales                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **v1.6.0**   | Notificaciones, políticas y comunicados Intel      | Plantillas de notificación por regla/por activador con vista previa en vivo, preferencias de campana de notificación, sincronización de preferencias entre dispositivos, cuadrícula de panel personalizado sin dependencia ([#281](https://github.com/CodesWhat/drydock/issues/281)), política de actualización declarativa ([#320](https://github.com/CodesWhat/drydock/issues/320)), cuenta regresiva de estabilización de madurez + visibilidad inmediata del candidato + anulación manual ([#406](https://github.com/CodesWhat/drydock/discussions/406)), panel de estado de actualización procesable y global Modo de actualización `notify` / `manual` / `auto` ([#325](https://github.com/CodesWhat/drydock/discussions/325)), herencia de políticas de etiquetas de observador/imgset/contenedor más actual apilada → visibilidad de etiquetas fijadas más nuevas ([#498](https://github.com/CodesWhat/drydock/issues/498)), fuente estandarizada de 44 px/notas de la versión/acciones de recursos de registro en tablas, tarjetas y detalles ([#295](https://github.com/CodesWhat/drydock/discussions/295)), notificaciones de eventos de estado de salud ([#198](https://github.com/CodesWhat/drydock/discussions/198)), Home Assistant MQTT bidireccional, vistas responsivas de tablas/listas de tarjetas, Trivy/Grype/análisis a través de comandos o backends de Docker-worker anclados, controles activos/de extracción de activos del escáner, deduplicación fuera del montón Almacenamiento SBOM, corrección de escaneo largo de Trivy ([#490](https://github.com/CodesWhat/drydock/issues/490)), advertencias de migración de taxonomía de activación, eliminaciones de compatibilidad v1.6, higiene de documentos/API y finalización de migración de `/api` → `/api/v1` con una cuña de compatibilidad de página de inicio/tarjeta wud opcional (`DD_COMPAT_WUDCARD`). |
| **v1.7.0**   | Actualizaciones inteligentes y UX                  | Ordenamiento consciente de la dependencia ([#219](https://github.com/CodesWhat/drydock/discussions/219)), actualizaciones masivas selectivas ([#232](https://github.com/CodesWhat/drydock/discussions/232)), política de actualización por acción ([#511](https://github.com/CodesWhat/drydock/discussions/511)), eliminación de imágenes, monitoreo de imágenes estáticas, reloj unificado de madurez/antigüedad de actualizaciones, enlaces de puertos en los que se puede hacer clic, atajos de teclado, PWA, revisión de contraste del tema oscuro (WCAG 2.2) ([#850](https://github.com/CodesWhat/drydock/issues/850), [#865](https://github.com/CodesWhat/drydock/discussions/865)), eliminación de `DD_TRIGGER_*` (fin de la ventana de obsolescencia de v1.5.0), curl eliminado de la imagen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **v1.8.0**   | Gestión de flotas y configuración en vivo          | Configuración YAML, configuración de UI en vivo, navegador de volúmenes, actualizaciones paralelas, migración de la tienda SQLite, progreso de actualización de Home Assistant y dispositivos por contenedor ([#210](https://github.com/CodesWhat/drydock/discussions/210)), imágenes creadas localmente monitoreadas contra una base upstream declarada ([#897](https://github.com/CodesWhat/drydock/discussions/897)), claves API giratorias con alcance (tokens de portador estáticos para integraciones de HA/panel, [#469](https://github.com/CodesWhat/drydock/discussions/469)), cola de aprobación por actualización |
| **v2.0+**                    | Expansión de plataforma y más allá                 | Vigilantes de enjambre/Kubernetes, GitOps, puertas de estado, implementaciones canary, terminal web, RBAC, LDAP/AD, proveedor nativo de Podman más allá de la API compatible con Docker, CLI, imagen reforzada de Wolfi, proxy de socket                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

</details>

<hr>

<h2 align="center" id="star-history">Historia de las estrellas</h2>

<div align="center">
  <a href="https://github.com/CodesWhat/drydock/stargazers">
    <img alt="Star History Chart" src="docs/assets/star-history.svg" />
  </a>
</div>

---

<div align="center">

<h2 align="center" id="built-with">Construido con</h2>

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

<h2 align="center" id="community-support">Comunidad y soporte</h2>

Chat en tiempo real y soporte temprano: **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**

Los errores y las solicitudes de funciones concretas van a **[GitHub Issues](https://github.com/CodesWhat/drydock/issues)**; las preguntas abiertas, ideas y demostraciones van a **[GitHub Discussions](https://github.com/CodesWhat/drydock/discussions)**; el chat en tiempo real ocurre en **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**.

### Control de calidad de la comunidad

Gracias a los usuarios que ayudaron a probar las versiones candidatas v1.4.0 y v1.5.0 y reportaron errores:

[@RK62](https://github.com/RK62) &middot; [@flederohr](https://github.com/flederohr) &middot; [@rj10rd](https://github.com/rj10rd) &middot; [@larueli](https://github.com/larueli) &middot; [@Waler](https://github.com/Waler) &middot; [@ElVit](https://github.com/ElVit) &middot; [@nchieffo](https://github.com/nchieffo) &middot; [@begunfx](https://github.com/begunfx) &middot; [@Ra72xx](https://github.com/Ra72xx)

<h2 align="center" id="codeswhat-ecosystem">Parte del ecosistema CodesWhat</h2>

<table>
  <tbody><tr><th>Herramienta</th><th>Rol</th></tr>
  <tr><td><b>drydock</b></td><td>Monitoreo de actualizaciones de contenedores: interfaz de usuario web y motor de notificaciones</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/portwing"><b>portwing</b></a></td><td>Agente Docker remoto: acceso seguro a nivel de socket desde Drydock o de forma independiente</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/sockguard"><b>sockguard</b></a></td><td>Proxy de socket de Docker: filtro de lista permitida de denegación predeterminada que protege el socket</td></tr>
</tbody></table>

Estas tres herramientas están diseñadas para capas: sockguard filtra el socket, portwing lo expone de forma remota y drydock monitorea y actúa sobre el estado del contenedor.

Consulte el [COMPATIBILITY.md de portwing](https://github.com/CodesWhat/portwing/blob/main/COMPATIBILITY.md) para obtener la matriz de compatibilidad completa entre las tres herramientas.

---

**[Licencia AGPL-3.0](LICENSE)**

<a href="https://github.com/CodesWhat">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/codeswhat-logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/codeswhat-logo-original.svg" />
    <img src="docs/assets/codeswhat-logo-original.svg" alt="CodesWhat" height="28">
  </picture>
</a>

<a href="#drydock">Volver arriba</a>

</div>
