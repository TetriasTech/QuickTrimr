// RULE-SCHED-04: inclusive elapsed-time bounds, independent of local/DST dates.
export type SchedulingConfig = {
  minimumLeadMinutes: number;
  maximumHorizonDays: number;
};
export function schedulingWindow(serverNow: number, config: SchedulingConfig) {
  return {
    minimum: serverNow + config.minimumLeadMinutes * 60_000,
    maximum: serverNow + config.maximumHorizonDays * 86_400_000,
  };
}
export function scheduledTimeIssue(
  requested: number,
  serverNow: number,
  config: SchedulingConfig,
) {
  const window = schedulingWindow(serverNow, config);
  if (!Number.isFinite(requested)) return 'Choose a requested date and time.';
  if (requested < window.minimum) return scheduledLeadGuidance(config);
  if (requested > window.maximum)
    return `Choose a requested time within ${config.maximumHorizonDays} days.`;
  return null;
}
export function scheduledLeadGuidance(config: SchedulingConfig) {
  const hours = config.minimumLeadMinutes / 60;
  const notice = Number.isInteger(hours)
    ? `${hours} hours`
    : `${config.minimumLeadMinutes} minutes`;
  return `Scheduled bookings need at least ${notice}' notice. Try Available Now for sooner.`;
}
