import { forbiddenResponse } from '@/lib/auth/forbidden-response';

export function GET() {
  return forbiddenResponse();
}
