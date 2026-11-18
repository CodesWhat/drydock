import { FileImageListError, parseImageListFile } from './file-entries.js';

function errorsFor(content: string): string[] {
  try {
    parseImageListFile(content);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(FileImageListError);
    return (error as FileImageListError).errors;
  }
  throw new Error('expected the file to be rejected');
}

describe('parseImageListFile', () => {
  test('parses a list of entries with names, labels and tag fields', () => {
    const entries = parseImageListFile(`
- image: ghcr.io/acme/app:1.4.0
  name: acme-app
  labels:
    dd.display.name: Acme
    dd.watch.digest: false
    dd.tag.family: loose
  tag:
    include: '^1\\.'
    exclude: rc
    transform: '^v(.*)$ => $1'
- image: nginx:1.25
`);

    expect(entries).toEqual([
      {
        name: 'acme-app',
        image: 'ghcr.io/acme/app:1.4.0',
        labels: {
          'dd.display.name': 'Acme',
          'dd.watch.digest': 'false',
          'dd.tag.family': 'loose',
          'dd.tag.include': '^1\\.',
          'dd.tag.exclude': 'rc',
          'dd.tag.transform': '^v(.*)$ => $1',
        },
      },
      { name: 'nginx', image: 'nginx:1.25', labels: {} },
    ]);
  });

  test('accepts a bare image string as shorthand', () => {
    expect(parseImageListFile('- redis:7\n- quay.io/org/tool:2')).toEqual([
      { name: 'redis', image: 'redis:7', labels: {} },
      { name: 'org-tool', image: 'quay.io/org/tool:2', labels: {} },
    ]);
  });

  test('accepts an explicitly empty list', () => {
    expect(parseImageListFile('[]')).toEqual([]);
  });

  test.each([
    ['', 'the file is empty; use "[]" for an empty list'],
    ['# only a comment\n', 'the file is empty; use "[]" for an empty list'],
    ['images:\n  - nginx', 'the file must contain a YAML list of images'],
  ])('rejects the file %j', (content, message) => {
    expect(errorsFor(content)).toEqual([message]);
  });

  test('rejects invalid YAML', () => {
    const [message] = errorsFor('- image: [unclosed');
    expect(message).toMatch(/^invalid YAML \(/);
  });

  test('reports every bad entry with its position', () => {
    const errors = errorsFor(`
- image: nginx:1.25
- name: no-image
- image: ghcr.io/acme/app@sha256:abc
- image: "has space:1"
- image: nginx:1.26
  name: bad name!
- 42
- image: ok:1
  colour: red
- image: ok:2
  labels:
    traefik.enable: "true"
    dd.tag.include: '['
    dd.tag.family: sideways
    dd.nested:
      a: b
- image: ok:3
  labels: [dd.watch]
- image: ok:4
  tag:
    include: ok
    nope: x
    exclude: ''
- image: ok:5
  tag: nope
- image: ok:6
  labels:
    dd.tag.include: '1'
  tag:
    include: '2'
- image: ""
`);

    expect(errors).toEqual([
      'entry 2: image is required and must be a string',
      'entry 3: image "ghcr.io/acme/app@sha256:abc" is digest-pinned; reference a tag instead, such as name:1.2.3',
      'entry 4: image "has space:1" must not contain whitespace',
      'entry 5: name must start with a letter or digit and use only letters, digits, ".", "_" and "-"',
      'entry 6: must be an image string or a map with an image field',
      'entry 7: unknown field "colour"',
      'entry 8: label "traefik.enable" is not allowed, only dd.* labels apply',
      'entry 8: label "dd.nested" must be a string, number or boolean',
      expect.stringMatching(/^entry 8: dd\.tag\.include is not a valid regular expression \(.+\)$/),
      'entry 8: dd.tag.family must be strict or loose, got "sideways"',
      'entry 9: labels must be a map of dd.* label names to values',
      'entry 10: unknown tag field "nope"',
      'entry 10: tag.exclude must be a non-empty string',
      'entry 11: tag must be a map with include, exclude, transform or family',
      'entry 12: tag.include and the dd.tag.include label are both set',
      'entry 13: image is required and must be a string',
    ]);
  });

  test('rejects an image that does not parse as a reference', () => {
    expect(errorsFor('- image: ":::"')).toEqual([
      'entry 1: image ":::" is not a valid image reference',
    ]);
  });

  test('rejects duplicate names and asks for a unique one', () => {
    expect(errorsFor('- nginx:1.25\n- nginx:1.26\n- image: nginx:1.27\n  name: other')).toEqual([
      'entry 2: name "nginx" is already used, set a unique name',
    ]);
  });
});
