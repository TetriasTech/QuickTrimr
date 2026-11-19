import { BarberServicesScreen } from '@/features/services/barber-services-screen';
import { useMobileSession } from '@/features/session/session-provider';

export default function BarberServicesRoute() {
  const { userId } = useMobileSession();
  return userId ? <BarberServicesScreen key={userId} userId={userId} /> : null;
}
