export const USER_ROLE = ['client', 'barber', 'admin'] as const;

export type UserRole = (typeof USER_ROLE)[number];
