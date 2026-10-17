import { labelOverridePaths } from './label-overrides.js';

describe('labelOverridePaths', () => {
  test('publishes the five operations with their revision and conflict contracts', () => {
    const container = labelOverridePaths['/api/v1/containers/{id}/label-overrides'];
    expect(Object.keys(container)).toEqual(['get', 'patch', 'delete']);
    expect(Object.keys(labelOverridePaths['/api/v1/label-overrides'])).toEqual(['get']);
    const row = labelOverridePaths['/api/v1/label-overrides/{overrideId}'].delete;
    expect(row.parameters.map((parameter) => parameter.name)).toEqual(['overrideId', 'revision']);
    expect(row.parameters[1]).toMatchObject({ required: true, schema: { minimum: 1 } });
    expect(container.delete.parameters[1]).toMatchObject({ schema: { minimum: 0 } });
    expect(Object.keys(container.patch.responses)).toEqual(
      expect.arrayContaining(['200', '400', '403', '404', '409', '413', '422']),
    );
  });
});
