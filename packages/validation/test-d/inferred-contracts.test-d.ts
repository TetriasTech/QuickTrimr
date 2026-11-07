import { CONTRACTS, SERVER_CONTROLLED_REQUEST_FIELDS } from '../src/index.ts';

import type {
  ContractName,
  ContractRequest,
  ContractResponse,
  IntegerCentsValue,
} from '../src/index.ts';
import type { IntegerCents } from '@quicktrimr/shared';
import type { z } from 'zod';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

type Expect<Condition extends true> = Condition;

export type EveryRequestIsInferred = {
  [Name in ContractName]: Expect<
    Equal<
      ContractRequest<Name>,
      z.infer<(typeof CONTRACTS)[Name]['requestSchema']>
    >
  >;
};

export type EveryResponseIsInferred = {
  [Name in ContractName]: Expect<
    Equal<
      ContractResponse<Name>,
      z.infer<(typeof CONTRACTS)[Name]['responseSchema']>
    >
  >;
};

type ForbiddenClientField = (typeof SERVER_CONTROLLED_REQUEST_FIELDS)[number];

type OrdinaryContractName = Exclude<
  ContractName,
  'admin-resolve-dispute' | 'admin-issue-refund'
>;
type ForbiddenFieldsByContract = {
  [Name in OrdinaryContractName]: Extract<
    keyof ContractRequest<Name>,
    ForbiddenClientField
  >;
};
export type NoRequestTypeContainsServerControlledFields = Expect<
  Equal<ForbiddenFieldsByContract[OrdinaryContractName], never>
>;

// P5-T07 permits bounded admin refund intent, not other server-owned amounts.
export type AdminRefundIntentIsBrandedCents = Expect<
  Equal<ContractRequest<'admin-issue-refund'>['refundCents'], IntegerCents>
>;
export type AdminRefundHasNoOtherServerFields = Expect<
  Equal<
    Extract<
      keyof ContractRequest<'admin-issue-refund'>,
      Exclude<ForbiddenClientField, 'refundCents'>
    >,
    never
  >
>;

export type IntegerCentsOutputUsesSharedBrand = Expect<
  Equal<IntegerCentsValue, IntegerCents>
>;
