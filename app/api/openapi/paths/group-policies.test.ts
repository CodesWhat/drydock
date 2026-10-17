import { openApiDocument } from '../index.js';
import { groupPolicyPaths } from './group-policies.js';

describe('groupPolicyPaths', () => {
  test('publishes exactly the five group policy operations', () => {
    expect(Object.keys(groupPolicyPaths)).toStrictEqual([
      '/api/v1/group-policies',
      '/api/v1/group-policies/{id}',
    ]);
    expect(Object.keys(groupPolicyPaths['/api/v1/group-policies'])).toStrictEqual(['get', 'post']);
    expect(Object.keys(groupPolicyPaths['/api/v1/group-policies/{id}'])).toStrictEqual([
      'get',
      'put',
      'delete',
    ]);
  });

  test('is part of the served document', () => {
    expect(openApiDocument.paths['/api/v1/group-policies']).toBe(
      groupPolicyPaths['/api/v1/group-policies'],
    );
    expect(openApiDocument.tags.map((tag) => tag.name)).toContain('Group policies');
  });

  test('requires the revision on delete and rejects unknown fields on writes', () => {
    const deletePath = groupPolicyPaths['/api/v1/group-policies/{id}'].delete;
    expect(deletePath.parameters.find((parameter) => parameter.name === 'revision')).toMatchObject({
      in: 'query',
      required: true,
    });
    const bodies = [
      groupPolicyPaths['/api/v1/group-policies'].post,
      groupPolicyPaths['/api/v1/group-policies/{id}'].put,
    ].map((operation) => operation.requestBody.content['application/json'].schema);
    for (const body of bodies) {
      expect(body.additionalProperties).toBe(false);
    }
  });

  test('writes accept restrict-only actions, and an actions-only policy needs no updatePolicy', () => {
    const operations = [
      groupPolicyPaths['/api/v1/group-policies'].post,
      groupPolicyPaths['/api/v1/group-policies/{id}'].put,
    ];
    for (const operation of operations) {
      const body = operation.requestBody.content['application/json'].schema;
      expect(body.properties.actions).toStrictEqual({
        $ref: '#/components/schemas/GroupPolicyActions',
      });
      expect(body.required).not.toContain('updatePolicy');
      expect(operation.description).toContain('actions');
      expect(operation.description).not.toContain('Unknown fields, including `actions`');
    }
  });

  test('every referenced component schema exists', () => {
    const refs = [...JSON.stringify(groupPolicyPaths).matchAll(/#\/components\/schemas\/(\w+)/g)];
    expect(refs.length).toBeGreaterThan(0);
    for (const [, name] of refs) {
      expect(Object.keys(openApiDocument.components.schemas)).toContain(name);
    }
  });
});
