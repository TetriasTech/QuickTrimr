import { Button } from '@quicktrimr/ui';
import { Link } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { mobileWorkspacePackages } from '@/workspace-contract';

export function AuthPlaceholderScreen() {
  return (
    <PlaceholderScreen
      title="Sign in"
      description="Authentication arrives in P1-T01."
      details={mobileWorkspacePackages.map((name) => `Resolved ${name}`)}
    >
      <Link asChild href="/ui-primitives">
        <Button label="View UI primitives" variant="secondary" />
      </Link>
      <Link asChild href="/state-foundations">
        <Button label="Try state foundations" variant="secondary" />
      </Link>
    </PlaceholderScreen>
  );
}
