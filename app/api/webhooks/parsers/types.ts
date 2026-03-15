export interface RegistryWebhookReference {
  image: string;
  tag: string;
}

export interface RegistryWebhookParseResult {
  provider: 'dockerhub' | 'ghcr' | 'harbor' | 'quay' | 'acr' | 'ecr';
  references: RegistryWebhookReference[];
}
