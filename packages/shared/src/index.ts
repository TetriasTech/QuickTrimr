export const QUICKTRIMR_PRODUCT = 'QuickTrimr' as const;

export type WorkspaceIdentity = {
  readonly product: typeof QUICKTRIMR_PRODUCT;
  readonly surface: 'mobile' | 'admin' | 'function';
};
