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
export {
  discoveryBounds,
  discoveryRadiusIssue,
  discoveryDistanceBand,
  compareDiscoveryKeys,
  type DiscoveryConfig,
  type DiscoverySortKey,
} from './discovery.ts';

export {
  schedulingWindow,
  scheduledTimeIssue,
  scheduledLeadGuidance,
  type SchedulingConfig,
} from './scheduling.ts';
export { discoveryMapAreas, type DiscoveryMapArea } from './discovery-map.ts';
export { requestSnapshot, type RequestPolicy } from './request-snapshot.ts';
