import {
  buildPortLink,
  detectPortScheme,
  enrichContainerPorts,
  getPortLabelOverride,
  normalizePortLabelKey,
  parsePortEntry,
  parsePortLabelOverrides,
} from '@/utils/ports';

describe('ports utils', () => {
  describe('parsePortEntry', () => {
    it('parses an unpublished bare port', () => {
      expect(parsePortEntry('443/tcp')).toEqual({
        raw: '443/tcp',
        containerPort: 443,
        protocol: 'tcp',
        hostIp: undefined,
        hostPort: undefined,
        published: false,
      });
    });

    it('parses a published port with no host IP', () => {
      expect(parsePortEntry('8080->80/tcp')).toEqual({
        raw: '8080->80/tcp',
        containerPort: 80,
        protocol: 'tcp',
        hostIp: undefined,
        hostPort: 8080,
        published: true,
      });
    });

    it('parses a published port with an IPv4 host', () => {
      expect(parsePortEntry('127.0.0.1:8080->80/tcp')).toEqual({
        raw: '127.0.0.1:8080->80/tcp',
        containerPort: 80,
        protocol: 'tcp',
        hostIp: '127.0.0.1',
        hostPort: 8080,
        published: true,
      });
    });

    it('parses a published port with an IPv6-ish host via the split-on-last-colon rule', () => {
      // Best-effort: "::1:8080" splits on the LAST colon, so hostIp becomes "::1" and
      // hostPort becomes "8080". Perfect IPv6 disambiguation is out of scope.
      expect(parsePortEntry('::1:8080->80/tcp')).toEqual({
        raw: '::1:8080->80/tcp',
        containerPort: 80,
        protocol: 'tcp',
        hostIp: '::1',
        hostPort: 8080,
        published: true,
      });
    });

    it('parses udp protocol', () => {
      expect(parsePortEntry('53->53/udp')).toMatchObject({
        containerPort: 53,
        protocol: 'udp',
      });
    });

    it('defaults to tcp for any protocol string other than literally "udp"', () => {
      expect(parsePortEntry('80/sctp')).toMatchObject({ protocol: 'tcp' });
    });

    it.each(['', 'garbage', 'nodigits/tcp', '80', '80-tcp'])(
      'returns null for malformed input %j',
      (raw) => {
        expect(parsePortEntry(raw)).toBeNull();
      },
    );

    it('returns null when the container port is not a finite non-negative integer', () => {
      expect(parsePortEntry('-1/tcp')).toBeNull();
      expect(parsePortEntry('1.5/tcp')).toBeNull();
      expect(parsePortEntry('abc/tcp')).toBeNull();
    });

    it('treats an unparseable host port as unpublished but still returns a parsed result', () => {
      expect(parsePortEntry('notaport->80/tcp')).toEqual({
        raw: 'notaport->80/tcp',
        containerPort: 80,
        protocol: 'tcp',
        hostIp: undefined,
        hostPort: undefined,
        published: false,
      });
    });

    it('returns null when an all-digit container port overflows to a non-finite number', () => {
      // 400 digits: passes the /^\d+$/ digits-only check but Number() overflows to Infinity.
      const hugePort = '9'.repeat(400);
      expect(parsePortEntry(`${hugePort}/tcp`)).toBeNull();
    });

    it('treats an all-digit overflowing host port as unpublished', () => {
      const hugePort = '9'.repeat(400);
      expect(parsePortEntry(`${hugePort}->80/tcp`)).toEqual({
        raw: `${hugePort}->80/tcp`,
        containerPort: 80,
        protocol: 'tcp',
        hostIp: undefined,
        hostPort: undefined,
        published: false,
      });
    });
  });

  describe('detectPortScheme', () => {
    it('returns https for 443', () => {
      expect(detectPortScheme(443)).toBe('https');
    });

    it('returns https for 8443', () => {
      expect(detectPortScheme(8443)).toBe('https');
    });

    it('returns http for any other port', () => {
      expect(detectPortScheme(80)).toBe('http');
      expect(detectPortScheme(8080)).toBe('http');
      expect(detectPortScheme(0)).toBe('http');
    });
  });

  describe('buildPortLink', () => {
    it('returns undefined for an unpublished port', () => {
      const parsed = parsePortEntry('443/tcp')!;
      expect(buildPortLink(parsed, 'example.test')).toBeUndefined();
    });

    it('falls back to browsingHost when hostIp is 0.0.0.0', () => {
      const parsed = parsePortEntry('0.0.0.0:8080->80/tcp')!;
      expect(buildPortLink(parsed, 'example.test')).toBe('http://example.test:8080');
    });

    it('falls back to browsingHost when hostIp is ::', () => {
      const parsed = parsePortEntry(':::8080->80/tcp')!;
      expect(parsed.hostIp).toBe('::');
      expect(buildPortLink(parsed, 'example.test')).toBe('http://example.test:8080');
    });

    it('falls back to browsingHost when hostIp is ::0', () => {
      const parsed: ReturnType<typeof parsePortEntry> = {
        raw: '::0:8080->80/tcp',
        containerPort: 80,
        protocol: 'tcp',
        hostIp: '::0',
        hostPort: 8080,
        published: true,
      };
      expect(buildPortLink(parsed!, 'example.test')).toBe('http://example.test:8080');
    });

    it('falls back to browsingHost when hostIp is unset', () => {
      const parsed = parsePortEntry('8080->80/tcp')!;
      expect(buildPortLink(parsed, 'example.test')).toBe('http://example.test:8080');
    });

    it('prefers a real host IP over browsingHost', () => {
      const parsed = parsePortEntry('192.168.1.5:8080->80/tcp')!;
      expect(buildPortLink(parsed, 'example.test')).toBe('http://192.168.1.5:8080');
    });

    it('uses https for container port 443', () => {
      const parsed = parsePortEntry('8443->443/tcp')!;
      expect(buildPortLink(parsed, 'example.test')).toBe('https://example.test:8443');
    });

    it('uses https for container port 8443', () => {
      const parsed = parsePortEntry('9443->8443/tcp')!;
      expect(buildPortLink(parsed, 'example.test')).toBe('https://example.test:9443');
    });

    it('uses http for any other container port', () => {
      const parsed = parsePortEntry('8080->80/tcp')!;
      expect(buildPortLink(parsed, 'example.test')).toBe('http://example.test:8080');
    });

    it('bracket-wraps an IPv6 browsingHost fallback', () => {
      const parsed = parsePortEntry('8080->80/tcp')!;
      expect(buildPortLink(parsed, '::1')).toBe('http://[::1]:8080');
    });

    it('bracket-wraps an IPv6 host IP', () => {
      const parsed: ReturnType<typeof parsePortEntry> = {
        raw: 'fd00::1:8080->80/tcp',
        containerPort: 80,
        protocol: 'tcp',
        hostIp: 'fd00::1',
        hostPort: 8080,
        published: true,
      };
      expect(buildPortLink(parsed!, 'example.test')).toBe('http://[fd00::1]:8080');
    });

    it('does not double-wrap a host that is already bracketed', () => {
      const parsed = parsePortEntry('8080->80/tcp')!;
      expect(buildPortLink(parsed, '[::1]')).toBe('http://[::1]:8080');
    });
  });

  describe('normalizePortLabelKey', () => {
    it('appends /tcp to a bare port', () => {
      expect(normalizePortLabelKey('80')).toBe('80/tcp');
    });

    it('leaves an already-suffixed port unchanged', () => {
      expect(normalizePortLabelKey('443/tcp')).toBe('443/tcp');
      expect(normalizePortLabelKey('53/udp')).toBe('53/udp');
    });

    it('trims whitespace', () => {
      expect(normalizePortLabelKey('  80  ')).toBe('80/tcp');
      expect(normalizePortLabelKey('  443/tcp  ')).toBe('443/tcp');
    });
  });

  describe('parsePortLabelOverrides', () => {
    it('parses multiple comma-separated pairs', () => {
      expect(parsePortLabelOverrides('80=Web UI,443/tcp=Admin Console')).toEqual({
        '80/tcp': 'Web UI',
        '443/tcp': 'Admin Console',
      });
    });

    it('allows a label containing =', () => {
      expect(parsePortLabelOverrides('80=Web UI (a=b)')).toEqual({
        '80/tcp': 'Web UI (a=b)',
      });
    });

    it('trims whitespace off port and label', () => {
      expect(parsePortLabelOverrides(' 80 = Web UI ')).toEqual({
        '80/tcp': 'Web UI',
      });
    });

    it('skips entries with no =', () => {
      expect(parsePortLabelOverrides('80=Web UI,garbage,443=Admin')).toEqual({
        '80/tcp': 'Web UI',
        '443/tcp': 'Admin',
      });
    });

    it('skips entries with an empty port', () => {
      expect(parsePortLabelOverrides('=Web UI,80=Web UI')).toEqual({
        '80/tcp': 'Web UI',
      });
    });

    it('skips entries with an empty (post-trim) label', () => {
      expect(parsePortLabelOverrides('80=  ,443=Admin')).toEqual({
        '443/tcp': 'Admin',
      });
    });

    it('returns {} for undefined input', () => {
      expect(parsePortLabelOverrides(undefined)).toEqual({});
    });

    it('returns {} for empty string input', () => {
      expect(parsePortLabelOverrides('')).toEqual({});
    });
  });

  describe('getPortLabelOverride', () => {
    it('returns the matching override', () => {
      const parsed = parsePortEntry('8080->80/tcp')!;
      expect(getPortLabelOverride(parsed, { '80/tcp': 'Web UI' })).toBe('Web UI');
    });

    it('returns undefined when there is no matching override', () => {
      const parsed = parsePortEntry('8080->80/tcp')!;
      expect(getPortLabelOverride(parsed, { '443/tcp': 'Admin' })).toBeUndefined();
    });
  });

  describe('enrichContainerPorts', () => {
    it('enriches a mix of labeled/unlabeled/published/unpublished/unparseable ports', () => {
      const ports = ['8080->80/tcp', '443/tcp', '127.0.0.1:9000->9000/tcp', 'garbage'];
      const result = enrichContainerPorts(ports, '80=Web UI,443/tcp=Admin Console', 'example.test');

      expect(result).toEqual([
        { raw: '8080->80/tcp', label: 'Web UI', href: 'http://example.test:8080' },
        { raw: '443/tcp', label: 'Admin Console', href: undefined },
        {
          raw: '127.0.0.1:9000->9000/tcp',
          label: '127.0.0.1:9000->9000/tcp',
          href: 'http://127.0.0.1:9000',
        },
        { raw: 'garbage', label: 'garbage', href: undefined },
      ]);
    });

    it('handles undefined portLabelRaw', () => {
      const result = enrichContainerPorts(['8080->80/tcp'], undefined, 'example.test');
      expect(result).toEqual([
        { raw: '8080->80/tcp', label: '8080->80/tcp', href: 'http://example.test:8080' },
      ]);
    });

    it('returns an empty array for no ports', () => {
      expect(enrichContainerPorts([], undefined, 'example.test')).toEqual([]);
    });
  });
});
