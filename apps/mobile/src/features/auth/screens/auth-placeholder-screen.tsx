import { PlaceholderScreen } from '@/components/placeholder-screen';
import { mobileWorkspacePackages } from '@/workspace-contract';

export function AuthPlaceholderScreen() {
  return (
    <PlaceholderScreen
      title="Sign in"
      description="Authentication arrives in P1-T01."
      details={mobileWorkspacePackages.map((name) => `Resolved ${name}`)}
    />
  );
}
