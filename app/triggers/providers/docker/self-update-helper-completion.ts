export type SelfUpdateHelperCompletion = {
  status: 'succeeded' | 'rolled-back';
  lastError?: string;
};

type PendingCompletion = {
  resolve: (completion: SelfUpdateHelperCompletion) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingCompletions = new Map<string, PendingCompletion>();
const completedBeforeWait = new Map<string, SelfUpdateHelperCompletion>();

export function waitForSelfUpdateHelperCompletion(
  operationId: string,
  timeoutMs: number,
): Promise<SelfUpdateHelperCompletion> {
  const completed = completedBeforeWait.get(operationId);
  if (completed) {
    completedBeforeWait.delete(operationId);
    return Promise.resolve(completed);
  }

  return new Promise<SelfUpdateHelperCompletion>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCompletions.delete(operationId);
      reject(new Error(`Observed self-update helper completion timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pendingCompletions.set(operationId, { resolve, reject, timeout });
  });
}

export function notifySelfUpdateHelperCompletion(
  operationId: string,
  completion: SelfUpdateHelperCompletion,
): void {
  const pending = pendingCompletions.get(operationId);
  if (!pending) {
    completedBeforeWait.set(operationId, completion);
    return;
  }
  pendingCompletions.delete(operationId);
  clearTimeout(pending.timeout);
  pending.resolve(completion);
}

export function clearSelfUpdateHelperCompletion(operationId: string): void {
  const pending = pendingCompletions.get(operationId);
  if (pending) {
    clearTimeout(pending.timeout);
    pending.reject(
      new Error(`Observed self-update helper completion cancelled for ${operationId}`),
    );
    pendingCompletions.delete(operationId);
  }
  completedBeforeWait.delete(operationId);
}
