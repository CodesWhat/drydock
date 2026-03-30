import { HttpResponse, http } from 'msw';
import { containers } from '../data/containers';
import { securityOverview } from '../data/vulnerabilities';

type MockContainer = (typeof containers)[number] & Record<string, unknown>;

export const securityHandlers = [
  http.get('/api/v1/containers/security/vulnerabilities', () =>
    HttpResponse.json(securityOverview),
  ),

  http.get('/api/v1/containers/:id/vulnerabilities', ({ params }) => {
    const container = containers.find((c) => c.id === params.id) as MockContainer | undefined;
    if (!container) return new HttpResponse(null, { status: 404 });

    // Find vulnerabilities for this container's image
    const imageEntry = securityOverview.images.find((img) =>
      img.containerIds.includes(container.id),
    );

    return HttpResponse.json({
      vulnerabilities: imageEntry?.vulnerabilities ?? [],
      summary: container.security?.scan?.summary ?? {
        unknown: 0,
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
    });
  }),

  http.get('/api/v1/containers/:id/sbom', () =>
    HttpResponse.json({
      spdxVersion: 'SPDX-2.3',
      dataLicense: 'CC0-1.0',
      name: 'demo-sbom',
      packages: [
        { name: 'openssl', versionInfo: '3.1.4', supplier: 'Organization: OpenSSL' },
        { name: 'zlib', versionInfo: '1.3', supplier: 'Organization: zlib' },
        { name: 'libcurl', versionInfo: '8.4.0', supplier: 'Organization: curl' },
        { name: 'sqlite', versionInfo: '3.44.0', supplier: 'Organization: SQLite' },
        { name: 'expat', versionInfo: '2.5.0', supplier: 'Organization: Expat' },
      ],
    }),
  ),
];
