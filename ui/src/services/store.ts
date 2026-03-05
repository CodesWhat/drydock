export interface StoreConfiguration {
  path: string;
  file: string;
}

export interface StoreResponse {
  configuration: StoreConfiguration;
}

async function getStore(): Promise<StoreResponse> {
  const response = await fetch('/api/store', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get store: ${response.statusText}`);
  }
  return response.json();
}

export { getStore };
