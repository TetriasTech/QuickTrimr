/* eslint-disable @typescript-eslint/no-require-imports -- Metro resolves bundled bitmap/vector assets from literal require paths. */
export const brandAssets = {
  arrowIcon: require('../../assets/icons/arrow-up-right.svg'),
  addressIcon: require('../../assets/icons/address.svg'),
  mark: require('../../assets/brand/mark-forest.svg'),
  markInverse: require('../../assets/brand/mark-citrus.svg'),
  editorial: require('../../assets/brand/editorial.png'),
} as const;
