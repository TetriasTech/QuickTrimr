export const USER_ROLE_VALUE = {
  CLIENT: 'client',
  BARBER: 'barber',
  ADMIN: 'admin',
} as const;

export const USER_ROLE = [
  USER_ROLE_VALUE.CLIENT,
  USER_ROLE_VALUE.BARBER,
  USER_ROLE_VALUE.ADMIN,
] as const;

export type UserRole = (typeof USER_ROLE)[number];
