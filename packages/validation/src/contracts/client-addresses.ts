import { z } from 'zod';

import {
  latitudeSchema,
  longitudeSchema,
  postgresUuidSchema,
  timestampSchema,
} from '../primitives.ts';

const australianAddressJurisdictions = [
  'ACT',
  'NSW',
  'NT',
  'QLD',
  'SA',
  'TAS',
  'VIC',
  'WA',
  'OT',
] as const;
const state = z.enum(
  australianAddressJurisdictions,
  'Enter an Australian state or territory',
);
const postcode = z
  .string()
  .trim()
  .regex(/^\d{4}$/, 'Enter a four-digit postcode');
const text = (limit: number) => z.string().trim().max(limit);
const requiredText = (limit: number, message: string) =>
  text(limit).min(1, message);
const directoryId = requiredText(24, 'Choose a suggested address');
const street = requiredText(160, 'Enter a street address');
const suburb = requiredText(100, 'Enter a suburb or locality');

export const clientAddressFieldsSchema = z.strictObject({
  label: requiredText(80, 'Enter a label for this address'),
  line1: street,
  suburb,
  state,
  postcode,
  unit: text(40),
  accessNotes: text(500),
});

const postalFields = clientAddressFieldsSchema.pick({
  line1: true,
  suburb: true,
  state: true,
  postcode: true,
  unit: true,
});
const candidateSchema = postalFields.extend({ directoryId });
const savedAddressSchema = clientAddressFieldsSchema.extend({
  id: postgresUuidSchema,
  archivedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
const writeResult = z.strictObject({
  address: savedAddressSchema,
  onboardingComplete: z.boolean(),
});

export const minimumAddressSearchLength = 3;

export const manageClientAddressesRequestSchema = z.discriminatedUnion(
  'operation',
  [
    z.strictObject({
      operation: z.literal('list'),
      after: postgresUuidSchema.optional(),
    }),
    z.strictObject({
      operation: z.literal('search'),
      query: text(160).min(
        minimumAddressSearchLength,
        'Enter more of the address',
      ),
    }),
    z.strictObject({
      operation: z.literal('nearby'),
      lat: latitudeSchema,
      lng: longitudeSchema,
    }),
    z.strictObject({
      operation: z.literal('create'),
      address: clientAddressFieldsSchema,
      directoryId: directoryId.optional(),
    }),
    z.strictObject({
      operation: z.literal('update'),
      id: postgresUuidSchema,
      address: clientAddressFieldsSchema,
      directoryId: directoryId.optional(),
    }),
    z.strictObject({ operation: z.literal('archive'), id: postgresUuidSchema }),
  ],
);

export const manageClientAddressesResponseSchema = z.discriminatedUnion(
  'operation',
  [
    z.strictObject({
      operation: z.literal('list'),
      addresses: z.array(savedAddressSchema),
      nextCursor: postgresUuidSchema.nullable(),
    }),
    z.strictObject({
      operation: z.literal('search'),
      candidates: z.array(candidateSchema),
    }),
    z.strictObject({
      operation: z.literal('nearby'),
      candidates: z.array(candidateSchema),
    }),
    writeResult.extend({ operation: z.literal('create') }),
    writeResult.extend({ operation: z.literal('update') }),
    writeResult.extend({ operation: z.literal('archive') }),
  ],
);

export type ClientAddressFields = z.infer<typeof clientAddressFieldsSchema>;
export type ClientAddressCandidate = z.infer<typeof candidateSchema>;
export type SavedClientAddress = z.infer<typeof savedAddressSchema>;
export type ManageClientAddressesRequest = z.infer<
  typeof manageClientAddressesRequestSchema
>;
export type ManageClientAddressesResponse = z.infer<
  typeof manageClientAddressesResponseSchema
>;
