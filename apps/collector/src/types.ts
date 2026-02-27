// Adapter configuration
export interface AdapterConfig {
  adapters: Array<{
    id: string;
    enabled: boolean;
  }>;
}

// Export default adapter configuration
export const defaultAdapterConfig: AdapterConfig = {
  adapters: [
    {
      id: 'ndw',
      enabled: true,
    },
  ],
};
