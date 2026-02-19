import { ref } from 'vue';

export function useSorting(defaultKey = 'name') {
  const sortKey = ref(defaultKey);
  const sortAsc = ref(true);

  function toggleSort(key: string) {
    if (sortKey.value === key) {
      sortAsc.value = !sortAsc.value;
    } else {
      sortKey.value = key;
      sortAsc.value = true;
    }
  }

  return { sortKey, sortAsc, toggleSort };
}
