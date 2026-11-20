import type { PublicBarberProfile } from '@quicktrimr/validation';

export function publicProfileInitials(displayName: string) {
  return displayName
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join('');
}
export function publicRatingLabel({
  rating,
  ratingCount,
}: Pick<PublicBarberProfile, 'rating' | 'ratingCount'>) {
  return rating === null || ratingCount === 0
    ? 'No reviews yet'
    : `${rating} out of 5 · ${ratingCount} reviews`;
}
