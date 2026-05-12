export interface BatchDispatchState<TEntry> {
  timer?: ReturnType<typeof setTimeout>;
  containers: Map<string, TEntry>;
}

export interface BatchDispatcherOptions<TRuleId extends string, TEntry> {
  dispatches: Map<TRuleId, BatchDispatchState<TEntry>>;
  flushDelayMs: number;
  getKey: (entry: TEntry) => string;
  flush: (ruleId: TRuleId, entries: TEntry[]) => Promise<void>;
  onUnexpectedError: (ruleId: TRuleId, error: unknown) => void;
}

export class BatchDispatcher<TRuleId extends string, TEntry> {
  private readonly dispatches: Map<TRuleId, BatchDispatchState<TEntry>>;
  private readonly flushDelayMs: number;
  private readonly getKey: (entry: TEntry) => string;
  private readonly flush: (ruleId: TRuleId, entries: TEntry[]) => Promise<void>;
  private readonly onUnexpectedError: (ruleId: TRuleId, error: unknown) => void;

  constructor(options: BatchDispatcherOptions<TRuleId, TEntry>) {
    this.dispatches = options.dispatches;
    this.flushDelayMs = options.flushDelayMs;
    this.getKey = options.getKey;
    this.flush = options.flush;
    this.onUnexpectedError = options.onUnexpectedError;
  }

  getOrCreate(ruleId: TRuleId): BatchDispatchState<TEntry> {
    const existing = this.dispatches.get(ruleId);
    if (existing) {
      return existing;
    }
    const created: BatchDispatchState<TEntry> = {
      containers: new Map(),
    };
    this.dispatches.set(ruleId, created);
    return created;
  }

  queue(ruleId: TRuleId, entry: TEntry): void {
    const dispatch = this.getOrCreate(ruleId);
    dispatch.containers.set(this.getKey(entry), entry);

    if (dispatch.timer) {
      clearTimeout(dispatch.timer);
    }

    dispatch.timer = setTimeout(() => {
      const entries = Array.from(dispatch.containers.values());
      dispatch.containers.clear();
      dispatch.timer = undefined;
      void this.flush(ruleId, entries).catch((error: unknown) => {
        this.onUnexpectedError(ruleId, error);
      });
    }, this.flushDelayMs);
  }

  clear(): void {
    for (const dispatch of this.dispatches.values()) {
      if (dispatch.timer) {
        clearTimeout(dispatch.timer);
      }
      dispatch.containers.clear();
      dispatch.timer = undefined;
    }
    this.dispatches.clear();
  }
}
