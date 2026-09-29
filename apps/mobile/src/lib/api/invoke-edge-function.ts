import {
  CONTRACTS,
  type ContractName,
  type ContractRequest,
  type ContractResponse,
  type ErrorResponse,
} from '@quicktrimr/validation';

export interface EdgeFunctionTransportResponse {
  status: number;
  body: unknown;
}

export interface EdgeFunctionTransport {
  invoke(
    functionName: string,
    options: { body: unknown },
  ): Promise<EdgeFunctionTransportResponse>;
}

export class EdgeFunctionError extends Error {
  readonly status: number;
  readonly response: ErrorResponse;

  constructor(status: number, response: ErrorResponse) {
    super(response.error);
    this.name = 'EdgeFunctionError';
    this.status = status;
    this.response = response;
  }
}

function isSuccessStatus(status: number) {
  return status >= 200 && status < 300;
}

/**
 * The single mobile mutation boundary for contract-backed Edge Functions.
 * Authentication and the concrete transport are supplied by the auth/API tickets.
 */
export async function invokeEdgeFunction<Name extends ContractName>(
  transport: EdgeFunctionTransport,
  functionName: Name,
  request: ContractRequest<Name>,
): Promise<ContractResponse<Name>> {
  const contract = CONTRACTS[functionName];
  const body = contract.requestSchema.parse(request);
  const response = await transport.invoke(functionName, { body });

  if (!isSuccessStatus(response.status)) {
    const error = contract.errorSchema.parse(response.body);
    throw new EdgeFunctionError(response.status, error);
  }

  return contract.responseSchema.parse(response.body) as ContractResponse<Name>;
}
