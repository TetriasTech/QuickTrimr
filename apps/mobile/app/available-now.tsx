import { AvailabilityScreen } from '@/features/availability/availability-screen';
import { useMobileSession } from '@/features/session/session-provider';
export default function AvailableNowRoute() {
  const { userId } = useMobileSession();
  return userId ? <AvailabilityScreen key={userId} userId={userId} /> : null;
}
