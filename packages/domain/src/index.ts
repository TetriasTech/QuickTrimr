export const DOMAIN_PACKAGE_NAME = '@quicktrimr/domain' as const;
export {
  parseAudPrice,
  audPriceText,
  servicePriceFits,
} from './service-price.ts';

export {
  connectVerificationStatus,
  type ConnectVerificationInput,
} from './connect-verification.ts';
export { bookingEligibility, availableNowBoundsFit } from './availability.ts';
export {
  availabilityTransition,
  availabilityWorkerHealth,
  type AvailabilityEvent,
} from './availability-transition.ts';
