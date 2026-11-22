import { Host, Picker } from '@expo/ui';
import { discoveryMapAreas } from '@quicktrimr/domain';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  radius,
  sizes,
  spacing,
  useTheme,
} from '@quicktrimr/ui';
import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import { createGestureRefresh } from './gesture-refresh';

import type { DiscoveryMapArea } from '@quicktrimr/domain';
import type { SearchAvailableNowBarbersResponse } from '@quicktrimr/validation';
import type { ReactNode } from 'react';

type Point = { lat: number; lng: number };
type Result = SearchAvailableNowBarbersResponse['results'][number];
function coordinate(point: Point) {
  return { latitude: point.lat, longitude: point.lng };
}

// Native-provider errors never fall back to an unapproved map provider.
class MapBoundary extends Component<
  { children: ReactNode; onList: () => void },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <ErrorState
        message="The map could not load. You can still browse the list."
        onRetry={this.props.onList}
        retryLabel="View list"
      />
    ) : (
      this.props.children
    );
  }
}
function GoogleAreaMap({
  point,
  areas,
  onSelect,
  onGestureStart,
  onGestureEnd,
  onReady,
  onLoad,
}: {
  point: Point;
  areas: DiscoveryMapArea[];
  onSelect: (id: string) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onReady: () => void;
  onLoad: () => void;
}) {
  const { colors, typography } = useTheme();
  const ref = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);
  useEffect(() => {
    if (!ready || fitted.current || !areas.length) return;
    fitted.current = true;
    ref.current?.fitToCoordinates(
      [coordinate(point), ...areas.map((a) => coordinate(a.mapPoint))],
      {
        edgePadding: {
          top: spacing.xl,
          bottom: spacing.xl,
          left: spacing.xl,
          right: spacing.xl,
        },
        animated: false,
      },
    );
  }, [ready, areas, point]);
  function recenter() {
    ref.current?.fitToCoordinates(
      [coordinate(point), ...areas.map((a) => coordinate(a.mapPoint))],
      {
        edgePadding: {
          top: spacing.xl,
          bottom: spacing.xl,
          left: spacing.xl,
          right: spacing.xl,
        },
        animated: false,
      },
    );
  }
  return (
    <View style={{ flex: 1, minHeight: sizes.mapMinHeight }}>
      <MapView
        ref={ref}
        testID="discovery-google-map"
        style={{ flex: 1 }}
        provider={PROVIDER_GOOGLE}
        initialCamera={{
          center: coordinate(point),
          zoom: sizes.mapInitialZoom,
          pitch: 0,
          heading: 0,
          altitude: 0,
        }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        onMapReady={() => {
          setReady(true);
          onReady();
        }}
        onMapLoaded={onLoad}
        onRegionChange={(_region, details) => {
          if (details.isGesture) {
            fitted.current = true;
            onGestureStart();
          }
        }}
        onRegionChangeComplete={(_region, details) => {
          if (details.isGesture) onGestureEnd();
        }}
      >
        <Marker
          identifier="service-address"
          testID="service-address-marker"
          coordinate={coordinate(point)}
          title="Your service address"
          accessibilityLabel="Your selected service address"
          pinColor={colors.accent}
        />
        {areas.map((area) => (
          <Marker
            key={area.areaId}
            identifier={area.areaId}
            testID={`area-${area.areaId}`}
            coordinate={coordinate(area.mapPoint)}
            onPress={() => onSelect(area.areaId)}
            title={`${area.label}: ${area.loadedCount} loaded matches`}
            description="Approximate service area, not a barber's location"
            accessibilityLabel={`${area.label}, ${area.loadedCount} loaded matches`}
            accessibilityRole="button"
          >
            <View
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                backgroundColor: colors.accent,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: colors.onAccent,
              }}
            >
              <Text style={[typography.headline, { color: colors.onAccent }]}>
                {area.loadedCount}
              </Text>
            </View>
          </Marker>
        ))}
      </MapView>
      <View
        style={{ position: 'absolute', top: spacing.sm, right: spacing.sm }}
      >
        <Button
          label="Recenter"
          size="small"
          variant="secondary"
          disabled={!ready}
          onPress={recenter}
        />
      </View>
    </View>
  );
}

export function DiscoveryMapScreen({
  point,
  results,
  refreshIntervalMs,
  serviceName,
  loading,
  refreshing,
  error,
  hasNextPage,
  fetchingNextPage,
  onRefresh,
  onMore,
  onSelectArea,
  onList,
  onFilters,
}: {
  point: Point;
  results: Result[];
  refreshIntervalMs: number;
  serviceName: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  onRefresh: () => Promise<unknown>;
  onMore: () => void;
  onSelectArea: (id: string) => void;
  onList: () => void;
  onFilters: () => void;
}) {
  const { colors, typography } = useTheme();
  const projection = useMemo(() => {
    try {
      return { areas: discoveryMapAreas(results), invalid: false };
    } catch {
      return { areas: [], invalid: true };
    }
  }, [results]);
  const [ready, setReady] = useState(false),
    [tilesLoaded, setTilesLoaded] = useState(false),
    [refreshFailed, setRefreshFailed] = useState(false);
  const refreshRef = useRef(onRefresh),
    policyRef = useRef(refreshIntervalMs);
  refreshRef.current = onRefresh;
  policyRef.current = refreshIntervalMs;
  const scheduler = useRef<ReturnType<typeof createGestureRefresh> | null>(
    null,
  );
  useEffect(() => {
    const current = createGestureRefresh({
      intervalMs: policyRef.current,
      refresh: async () => {
        setRefreshFailed(false);
        await refreshRef.current();
      },
      onError: () => setRefreshFailed(true),
    });
    scheduler.current = current;
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') current.cancel();
    });
    return () => {
      current.dispose();
      scheduler.current = null;
      listener.remove();
    };
  }, []);
  useEffect(() => {
    scheduler.current?.updateInterval(refreshIntervalMs);
  }, [refreshIntervalMs]);
  const retry = () => {
    refreshRef.current().catch(() => setRefreshFailed(true));
  };
  return (
    <Screen
      edges={['right', 'bottom', 'left']}
      contentContainerStyle={{ flex: 1, padding: 0, gap: 0 }}
    >
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            label="View list"
            variant="secondary"
            size="small"
            onPress={onList}
          />
          <Button
            label="Change filters"
            variant="ghost"
            size="small"
            onPress={onFilters}
          />
        </View>
        <Text accessibilityRole="header" style={typography.headline}>
          {serviceName}
        </Text>
        <Text style={typography.caption}>
          Counts show loaded matches. Pins mark shared approximate areas, not
          barber locations. Your selected service address stays the search
          centre.
        </Text>
        {projection.areas.length ? (
          <Host seedColor={colors.accent} matchContents>
            <Picker
              testID="map-area-picker"
              selectedValue=""
              onValueChange={(id) => {
                if (id) onSelectArea(String(id));
              }}
            >
              <Picker.Item value="" label="Choose an area" />
              {projection.areas.map((a) => (
                <Picker.Item
                  key={a.areaId}
                  value={a.areaId}
                  label={`${a.label} · ${a.loadedCount} loaded matches`}
                />
              ))}
            </Picker>
          </Host>
        ) : null}
        {loading ? <LoadingState message="Updating map matches…" /> : null}
        {error || refreshFailed || projection.invalid ? (
          <ErrorState
            message={
              error ??
              (projection.invalid
                ? 'Public map areas could not be read safely. Refresh or browse the list.'
                : 'Could not refresh the map. Try again.')
            }
            onRetry={retry}
          />
        ) : null}
      </View>
      {!projection.invalid ? (
        <MapBoundary onList={onList}>
          <GoogleAreaMap
            point={point}
            areas={projection.areas}
            onSelect={onSelectArea}
            onGestureStart={() => scheduler.current?.begin()}
            onGestureEnd={() => scheduler.current?.complete()}
            onReady={() => setReady(true)}
            onLoad={() => setTilesLoaded(true)}
          />
        </MapBoundary>
      ) : null}
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        {!ready && !projection.invalid ? (
          <LoadingState message="Loading map…" />
        ) : ready ? (
          <Text testID="map-status" style={typography.caption}>
            {tilesLoaded ? 'Map loaded' : 'Map ready'} · {results.length} loaded
            matches
          </Text>
        ) : null}
        {!loading &&
        !error &&
        !refreshFailed &&
        !projection.invalid &&
        !results.length ? (
          <EmptyState
            message="No barbers matched these filters. Try a wider radius, another service or Scheduled."
            action={{ label: 'Change search', onPress: onFilters }}
          />
        ) : null}
        {hasNextPage ? (
          <Button
            label="Load more barbers"
            variant="secondary"
            loading={fetchingNextPage}
            disabled={refreshing || loading}
            onPress={onMore}
          />
        ) : null}
        <Button
          label="Refresh map"
          variant="ghost"
          size="small"
          disabled={loading}
          onPress={retry}
        />
      </View>
    </Screen>
  );
}
