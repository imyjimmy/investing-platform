export {};

declare global {
  interface Window {
    Plaid?: {
      create(config: {
        token: string;
        onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
        onExit?: (error: unknown, metadata: PlaidLinkMetadata) => void;
      }): {
        open(): void;
      };
    };
  }
  interface PlaidLinkMetadata {
    institution?: {
      institution_id?: string | null;
      name?: string | null;
    } | null;
    accounts?: Array<{
      id?: string | null;
      name?: string | null;
    }>;
  }
}
