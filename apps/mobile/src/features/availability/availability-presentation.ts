import type { AvailStatus, ReliabilityLevel } from '@quicktrimr/shared';
import type { OwnAvailableNowState } from '@quicktrimr/validation';
export const standingLabels: Record<ReliabilityLevel, string> = {
  good_standing: 'Good standing',
  watch: 'Watch',
  limited: 'Limited',
  restricted: 'Restricted',
  suspended: 'Suspended',
};
export const sessionStatusText: Record<AvailStatus, string> = {
  active: 'Available Now is on',
  busy: 'Off — a job was accepted',
  expired: 'Off — your available time ended',
  manually_disabled: 'Off — you switched availability off',
  auto_disabled: 'Off — consecutive requests were missed',
  cancelled: 'Off — this session was replaced or cancelled',
};
export function availabilityStatus(state: OwnAvailableNowState) {
  if (!state.session) return 'Available Now is off';
  if (state.session.status === 'active' && !state.session.isActive)
    return state.session.availableUntil &&
      Date.parse(state.session.availableUntil) <= Date.parse(state.serverNow)
      ? sessionStatusText.expired
      : 'Off — your session needs new location details';
  return sessionStatusText[state.session.status];
}
export function remainingText(end: string, serverNow: string) {
  const minutes = Math.max(
    0,
    Math.ceil((Date.parse(end) - Date.parse(serverNow)) / 60000),
  );
  return `${minutes} minute${minutes === 1 ? '' : 's'} remaining when refreshed`;
}
export function restrictionText(state: OwnAvailableNowState) {
  const r = state.reliability;
  if (r.requiresHumanReinstatement)
    return 'Your standing is suspended. Human reinstatement is required; there is no automatic return date.';
  if (!r.availableNowAllowed && r.cooldownUntil)
    return `Available Now is paused until ${new Date(r.cooldownUntil).toLocaleString()}. Refresh then to check your standing.`;
  if (r.level === 'restricted')
    return 'You can use Available Now. Your profile appears after other eligible barbers, and your standing needs review.';
  if (r.level === 'watch')
    return 'Your standing has a warning. Available Now remains available.';
  if (r.level === 'limited')
    return 'Your standing is limited. There is no active Available Now cooldown.';
  return 'Your standing is good. There is no reliability restriction.';
}
