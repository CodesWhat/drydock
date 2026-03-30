import type { Ref } from 'vue';
import { errorMessage } from '../../utils/error';

export async function loadContainerDetailListState(args: {
  containerId: string | undefined;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  value: Ref<Record<string, unknown>[]>;
  loader: (containerId: string) => Promise<unknown[]>;
  failureMessage: string;
}) {
  if (!args.containerId) {
    args.value.value = [];
    return;
  }

  args.loading.value = true;
  args.error.value = null;
  try {
    args.value.value = (await args.loader(args.containerId)) as Record<string, unknown>[];
  } catch (e: unknown) {
    args.value.value = [];
    args.error.value = errorMessage(e, args.failureMessage);
  } finally {
    args.loading.value = false;
  }
}
