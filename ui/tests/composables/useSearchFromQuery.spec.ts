import { effectScope, nextTick, reactive, ref } from 'vue';
import { useSearchFromQuery } from '@/composables/useSearchFromQuery';

const route = reactive<{ query: { q?: unknown } }>({ query: {} });

vi.mock('vue-router', () => ({
  useRoute: () => route,
}));

function setup() {
  const searchQuery = ref('initial');
  const scope = effectScope();
  let api: ReturnType<typeof useSearchFromQuery> | undefined;
  scope.run(() => {
    api = useSearchFromQuery(searchQuery);
  });
  return { searchQuery, scope, api: api! };
}

describe('useSearchFromQuery', () => {
  beforeEach(() => {
    route.query = {};
  });

  it('seeds the search from the initial q', () => {
    route.query = { q: 'nginx' };
    const { searchQuery, scope } = setup();
    expect(searchQuery.value).toBe('nginx');
    scope.stop();
  });

  it('clears the search when q is missing', () => {
    const { searchQuery, scope } = setup();
    expect(searchQuery.value).toBe('');
    scope.stop();
  });

  it('uses the first value of a repeated q', () => {
    route.query = { q: ['first', 'second'] };
    const { searchQuery, scope } = setup();
    expect(searchQuery.value).toBe('first');
    scope.stop();
  });

  it('clears the search for a non-string q', () => {
    route.query = { q: 42 };
    const { searchQuery, scope } = setup();
    expect(searchQuery.value).toBe('');
    scope.stop();
  });

  it('follows later q changes', async () => {
    const { searchQuery, scope } = setup();
    route.query = { q: 'redis' };
    await nextTick();
    expect(searchQuery.value).toBe('redis');
    route.query = {};
    await nextTick();
    expect(searchQuery.value).toBe('');
    scope.stop();
  });

  it('exposes applySearchFromQuery', () => {
    const { searchQuery, scope, api } = setup();
    api.applySearchFromQuery(['x']);
    expect(searchQuery.value).toBe('x');
    scope.stop();
  });
});
