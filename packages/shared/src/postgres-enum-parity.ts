import { SHARED_ENUMS } from './enums/registry.ts';
import type { SharedEnumId } from './enums/registry.ts';

export function assertPostgresEnumValuesMatch(
  knowledgeBaseId: SharedEnumId,
  actualValues: readonly string[],
): void {
  const expectedValues = SHARED_ENUMS[knowledgeBaseId];
  const matches =
    actualValues.length === expectedValues.length &&
    actualValues.every((value, index) => value === expectedValues[index]);

  if (!matches) {
    throw new Error(
      `${knowledgeBaseId} Postgres values do not match packages/shared: expected ${JSON.stringify(expectedValues)}, received ${JSON.stringify(actualValues)}`,
    );
  }
}
