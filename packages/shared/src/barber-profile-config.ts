// CFG-BARBER-SERVICE-RADIUS-KM and CFG-BARBER-PHOTO-LIMITS.
export const barberServiceRadiusKm = { min: 1, max: 50 } as const;

export const barberPhotoLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxPixelsPerSide: 2048,
  signedUrlSeconds: 10 * 60,
} as const;
