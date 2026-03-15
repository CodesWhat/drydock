import { HttpResponse, http } from 'msw';

type TypeNameItem = {
  type: string;
  name: string;
};

function toPathParam(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function findByTypeAndName<T extends TypeNameItem>(
  items: readonly T[],
  typeParam: string | readonly string[] | undefined,
  nameParam: string | readonly string[] | undefined,
): T | undefined {
  const type = toPathParam(typeParam);
  const name = toPathParam(nameParam);
  if (!type || !name) {
    return undefined;
  }
  return items.find((item) => item.type === type && item.name === name);
}

export function createTypeNameHandlers<T extends TypeNameItem>(
  basePath: string,
  items: readonly T[],
) {
  return [
    http.get(basePath, () => HttpResponse.json({ data: items })),
    http.get(`${basePath}/:type/:name`, ({ params }) => {
      const item = findByTypeAndName(items, params.type, params.name);
      if (!item) return new HttpResponse(null, { status: 404 });
      return HttpResponse.json(item);
    }),
    http.get(`${basePath}/:type/:name/:agent`, ({ params }) => {
      const item = findByTypeAndName(items, params.type, params.name);
      if (!item) return new HttpResponse(null, { status: 404 });
      return HttpResponse.json(item);
    }),
  ];
}
