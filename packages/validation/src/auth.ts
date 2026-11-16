import { z } from 'zod';

export const authEmailSchema = z
  .string()
  .trim()
  .pipe(z.email('Enter a valid email address.'));
export const authPasswordSchema = z.string().min(1, 'Enter your password.');
export const authCodeSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, 'Enter the code from your email.');
