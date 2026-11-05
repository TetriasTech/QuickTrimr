// Opt-in development entry only. Do not import fixtures from production paths.
import { ALL_CONTRACT_EXAMPLES } from './all-examples.ts';
import { CONTRACT_DETAILS } from './contract-details.ts';
import { CONTRACTS } from './contracts/index.ts';

import type {
  ContractName,
  ContractRequest,
  ContractResponse,
} from './contracts/index.ts';
import type { ErrorResponse } from './error-response.ts';

export type ContractFixture<Name extends ContractName> = {
  readonly request: ContractRequest<Name>;
  readonly response: ContractResponse<Name>;
  readonly errors: readonly {
    readonly status: number;
    readonly body: ErrorResponse;
  }[];
};

function fixture<Name extends ContractName>(name: Name): ContractFixture<Name> {
  const contract = CONTRACTS[name];
  const examples = ALL_CONTRACT_EXAMPLES[name];
  return {
    request: contract.requestSchema.parse(
      examples.request.valid,
    ) as ContractRequest<Name>,
    response: contract.responseSchema.parse(
      examples.response.valid,
    ) as ContractResponse<Name>,
    errors: CONTRACT_DETAILS[name].errors.map(({ status, code }) => ({
      status,
      body: contract.errorSchema.parse(
        code === 'validation_failed'
          ? {
              error: code,
              fields: {
                _request: 'Invalid request or server-side business validation',
              },
            }
          : { error: code },
      ),
    })),
  };
}

// Runtime exact-set/parsing tests guard this heterogeneous registry boundary.
export const API_FIXTURES = Object.fromEntries(
  (Object.keys(CONTRACTS) as ContractName[]).map((name) => [
    name,
    fixture(name),
  ]),
) as { readonly [Name in ContractName]: ContractFixture<Name> };

export { CONTRACT_DETAILS } from './contract-details.ts';
