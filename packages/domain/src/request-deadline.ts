/** Compare a stored deadline with a server-owned instant in the same time unit. */
export function requestDeadlineReached(deadline: number, serverNow: number) {
  return deadline <= serverNow;
}
