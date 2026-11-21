import {
  integerCentsSchema,
  type GetPublicBarberProfileResponse,
} from '@quicktrimr/validation';
import { API_FIXTURES } from '@quicktrimr/validation/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { PublicBarberProfileScreen } from '../src/features/public-profiles/public-profile-screen';

jest.mock('expo-image', () => ({ Image: () => null }));
const fixture = API_FIXTURES['get-public-barber-profile'].response;
const profile = fixture.profile!;
const page = jest.fn<
  Promise<GetPublicBarberProfileResponse>,
  [unknown, AbortSignal]
>();
const back = jest.fn();
const caches: QueryClient[] = [];
async function mount(barberId = profile.barberId) {
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  caches.push(cache);
  await render(
    <QueryClientProvider client={cache}>
      <PublicBarberProfileScreen
        userId="synthetic-client"
        barberId={barberId}
        api={{ page }}
        selectedServiceId={profile.services[0]!.serviceCategoryId}
        photoBaseUrl="http://127.0.0.1:55321"
        onBack={back}
      />
    </QueryClientProvider>,
  );
  return cache;
}
beforeEach(() => {
  jest.resetAllMocks();
  page.mockResolvedValue(fixture);
});
afterEach(async () => {
  await cleanup();
  caches.splice(0).forEach((cache) => cache.clear());
});

test('P0-T08 fixture renders all public fields and current cents with no live backend', async () => {
  await mount();
  await waitFor(() =>
    expect(screen.getByText('Marcus Example')).toBeOnTheScreen(),
  );
  expect(screen.getByText(profile.bio)).toBeOnTheScreen();
  expect(screen.getByText('10 years of experience')).toBeOnTheScreen();
  expect(screen.getByLabelText('Marcus Example initials')).toBeOnTheScreen();
  expect(screen.getByText('Richmond')).toBeOnTheScreen();
  expect(screen.getByText('Skin Fade')).toBeOnTheScreen();
  expect(screen.getByText('A$45.50')).toBeOnTheScreen();
  expect(screen.getByText('Selected service')).toBeOnTheScreen();
  expect(screen.getByText('No reviews yet')).toBeOnTheScreen();
  expect(screen.queryByText(/5\.0/)).not.toBeOnTheScreen();
});
test('initial loading never claims an empty profile', async () => {
  page.mockImplementationOnce(() => new Promise(() => {}));
  await mount();
  expect(screen.getByText('Loading barber profile…')).toBeOnTheScreen();
  expect(screen.queryByText(/profile is unavailable/)).not.toBeOnTheScreen();
});
test('load failure retries into content', async () => {
  page.mockRejectedValueOnce(new Error('offline'));
  await mount();
  await waitFor(() =>
    expect(
      screen.getByText('Could not load this barber profile.'),
    ).toBeOnTheScreen(),
  );
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.getByText('A$45.50')).toBeOnTheScreen());
});
test('unavailable profile and invalid links offer back; invalid link makes no API call', async () => {
  page.mockResolvedValue({ profile: null });
  await mount();
  await waitFor(() =>
    expect(
      screen.getByText(/This barber profile is unavailable/),
    ).toBeOnTheScreen(),
  );
  await fireEvent.press(screen.getByText('Back'));
  expect(back).toHaveBeenCalledTimes(1);
  await cleanup();
  page.mockClear();
  await mount('bad-id');
  expect(
    screen.getByText('This barber profile link is invalid.'),
  ).toBeOnTheScreen();
  expect(page).not.toHaveBeenCalled();
});
test('no active services keeps the profile and honest review state', async () => {
  page.mockResolvedValue({
    profile: { ...profile, photoUrl: null, services: [] },
  });
  await mount();
  await waitFor(() =>
    expect(screen.getByText(/no active services listed/)).toBeOnTheScreen(),
  );
  expect(screen.getByText('Marcus Example')).toBeOnTheScreen();
  expect(screen.getByText('No reviews yet')).toBeOnTheScreen();
});
test('refresh failure preserves loaded details; successful retry takes current server price', async () => {
  const cache = await mount();
  await waitFor(() => expect(screen.getByText('A$45.50')).toBeOnTheScreen());
  page.mockRejectedValueOnce(new Error('refresh failed'));
  await cache.invalidateQueries();
  await waitFor(() =>
    expect(screen.getByText(/Could not refresh all prices/)).toBeOnTheScreen(),
  );
  expect(screen.getByText('A$45.50')).toBeOnTheScreen();
  page.mockResolvedValue({
    profile: {
      ...profile,
      services: [
        { ...profile.services[0]!, priceCents: integerCentsSchema.parse(4625) },
      ],
    },
  });
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.getByText('A$46.25')).toBeOnTheScreen());
});
test('bounded service continuation retains selection, deduplicates and follows the server cursor', async () => {
  const cursor = {
    displayOrder: 1,
    slug: 'skin_fade',
    id: profile.services[0]!.id,
  };
  page.mockResolvedValueOnce({
    profile: { ...profile, nextServicesCursor: cursor },
  });
  await mount();
  await waitFor(() =>
    expect(screen.getByText('More services')).toBeOnTheScreen(),
  );
  await fireEvent.press(screen.getByText('More services'));
  await waitFor(() =>
    expect(screen.queryByText('More services')).not.toBeOnTheScreen(),
  );
  expect(page.mock.calls[1]![0]).toEqual(cursor);
  expect(screen.getAllByText('A$45.50')).toHaveLength(1);
});

test('eligibility lost between service pages removes the previously loaded profile', async () => {
  const cursor = {
    displayOrder: 1,
    slug: 'skin_fade',
    id: profile.services[0]!.id,
  };
  page
    .mockResolvedValueOnce({
      profile: { ...profile, nextServicesCursor: cursor },
    })
    .mockResolvedValue({ profile: null });
  await mount();
  await waitFor(() =>
    expect(screen.getByText('More services')).toBeOnTheScreen(),
  );
  await fireEvent.press(screen.getByText('More services'));
  await waitFor(() =>
    expect(
      screen.getByText(/This barber profile is unavailable/),
    ).toBeOnTheScreen(),
  );
  expect(screen.queryByText('A$45.50')).not.toBeOnTheScreen();
});

test('selected service beyond the first page appears immediately with current server cents, then explicitly becomes unavailable', async () => {
  page.mockResolvedValue({
    profile: {
      ...profile,
      services: [],
      selectedService: {
        ...profile.services[0]!,
        priceCents: integerCentsSchema.parse(4625),
      },
    },
  });
  const cache = await mount();
  await screen.findByText('A$46.25');
  expect(page).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Current price/)).toBeTruthy();
  page.mockResolvedValue({
    profile: { ...profile, services: [], selectedService: null },
  });
  await cache.invalidateQueries();
  await screen.findByText(/This selected service is no longer available/);
  expect(screen.queryByText('A$46.25')).toBeNull();
});
