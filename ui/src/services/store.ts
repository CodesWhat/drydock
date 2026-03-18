interface StoreConfiguration {
  path: string;
  file: string;
}

interface StoreResponse {
  configuration: StoreConfiguration;
}

async function getStore(): Promise<StoreResponse> {
  const response = await fetch('/api/v1/store', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get store: ${response.statusText}`);
  }
  return response.json();
}

export { getStore };
