# Validation

Shared Zod request and response contracts for QuickTrimr's core marketplace operations.

Import a named schema or use `CONTRACTS` when a function name is only known at runtime:

```ts
import {
  createBookingRequestRequestSchema,
  type CreateBookingRequestRequest,
} from '@quicktrimr/validation';

const request: CreateBookingRequestRequest =
  createBookingRequestRequestSchema.parse(untrustedBody);
```

Request parsing removes client-supplied identity, status and server-derived financial fields before
strict validation. Other unknown fields are rejected. Response schemas remain strict so additional
private fields cannot silently leak into a documented response.

All status validators and literals come from `@quicktrimr/shared`. Payload types are inferred with
`z.infer`; do not declare parallel interfaces.
