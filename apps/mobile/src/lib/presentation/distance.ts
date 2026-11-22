import type { SearchAvailableNowBarbersResponse } from '@quicktrimr/validation';

type DistanceBand =
  SearchAvailableNowBarbersResponse['results'][number]['distanceBand'];

export const distanceBandLabels: Record<DistanceBand, string> = {
  'under-2km': 'Under 2 km away',
  '2-5km': '2–5 km away',
  '5-10km': '5–10 km away',
  '10km+': '10 km or more away',
};
