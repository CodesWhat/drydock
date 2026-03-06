import { reactive } from 'vue';
import { usePreference } from '@/preferences/usePreference';

describe('usePreference', () => {
  it('should read through the provided getter', () => {
    const state = reactive({ theme: { variant: 'dark' as 'dark' | 'light' | 'system' } });
    const themeVariant = usePreference(
      () => state.theme.variant,
      (value) => {
        state.theme.variant = value;
      },
    );

    expect(themeVariant.value).toBe('dark');

    state.theme.variant = 'light';
    expect(themeVariant.value).toBe('light');
  });

  it('should write through the provided setter', () => {
    const state = reactive({ layout: { sidebarCollapsed: false } });
    const setter = vi.fn((value: boolean) => {
      state.layout.sidebarCollapsed = value;
    });
    const sidebarCollapsed = usePreference(() => state.layout.sidebarCollapsed, setter);

    sidebarCollapsed.value = true;

    expect(setter).toHaveBeenCalledTimes(1);
    expect(setter).toHaveBeenCalledWith(true);
    expect(state.layout.sidebarCollapsed).toBe(true);
  });

  it('should support complex preference values', () => {
    type SortPreference = {
      key: string;
      asc: boolean;
    };

    const state = reactive<{ containers: { sort: SortPreference } }>({
      containers: {
        sort: { key: 'name', asc: true },
      },
    });

    const sort = usePreference(
      () => state.containers.sort,
      (value) => {
        state.containers.sort = value;
      },
    );

    const nextSort: SortPreference = { key: 'status', asc: false };
    sort.value = nextSort;

    expect(state.containers.sort).toEqual(nextSort);
    expect(sort.value).toEqual(nextSort);
  });
});
