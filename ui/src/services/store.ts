export interface StoreConfiguration {
  path: string;
  file: string;
}

export interface StoreResponse {
  configuration: StoreConfiguration;
}

async function getStore(): Promise<StoreResponse> {
  const response = await fetch('/api/store', { credentials: 'include' });
  return response.json();
}

export { getStore };
