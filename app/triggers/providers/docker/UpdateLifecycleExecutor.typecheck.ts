import type UpdateLifecycleExecutor from './UpdateLifecycleExecutor.js';

type UpdateLifecycleOptions = ConstructorParameters<typeof UpdateLifecycleExecutor>[0];
type LifecycleContainer = Parameters<UpdateLifecycleExecutor['run']>[0];
type LifecycleContext = NonNullable<
  Awaited<ReturnType<UpdateLifecycleOptions['context']['createTriggerContext']>>
>;

const validContainer: LifecycleContainer = {
  id: 'container-id',
  name: 'web',
};

const validContext: LifecycleContext = {
  dockerApi: {},
  registry: {},
  auth: {},
  newImage: 'ghcr.io/acme/web:2.0.0',
};

// @ts-expect-error lifecycle containers should not accept arbitrary keys
const invalidContainer: LifecycleContainer = { name: 'web', customState: true };

// @ts-expect-error lifecycle contexts should not accept arbitrary keys
const invalidContext: LifecycleContext = { dockerApi: {}, registry: {}, customState: true };

void validContainer;
void validContext;
void invalidContainer;
void invalidContext;
