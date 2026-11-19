import * as Location from 'expo-location';

// Bound a foreground sensor request, not a session/cooldown/booking deadline.
// An unavailable GPS must release the form for manual entry; late results are ignored.
export async function currentWorkingPoint() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Location unavailable')),
          10_000,
        );
      }),
    ]);
    return {
      type: 'gps' as const,
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
