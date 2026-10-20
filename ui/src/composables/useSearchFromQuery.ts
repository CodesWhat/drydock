import { type Ref, watch } from 'vue';
import { useRoute } from 'vue-router';

/**
 * Seeds a view's search box from the `?q=` route query and keeps it in sync
 * when the query changes. A repeated `q` uses its first value; a missing or
 * non-string value clears the search.
 */
export function useSearchFromQuery(searchQuery: Ref<string>) {
  const route = useRoute();

  function applySearchFromQuery(queryValue: unknown) {
    const raw = Array.isArray(queryValue) ? queryValue[0] : queryValue;
    searchQuery.value = typeof raw === 'string' ? raw : '';
  }

  applySearchFromQuery(route.query.q);
  watch(
    () => route.query.q,
    (value) => applySearchFromQuery(value),
  );

  return { applySearchFromQuery };
}
