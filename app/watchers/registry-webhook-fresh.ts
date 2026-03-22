const freshContainerIds = new Set<string>();

export function markContainerFreshForScheduledPollSkip(containerId: string) {
  if (typeof containerId !== 'string' || containerId.trim() === '') {
    return;
  }
  freshContainerIds.add(containerId);
}

export function consumeFreshContainerScheduledPollSkip(containerId: string): boolean {
  if (!freshContainerIds.has(containerId)) {
    return false;
  }

  freshContainerIds.delete(containerId);
  return true;
}

export function _resetRegistryWebhookFreshStateForTests() {
  freshContainerIds.clear();
}
