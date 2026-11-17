import {
  barberAreaLookupResultSchema,
  barberPhotoUploadResultSchema,
  errorResponseSchema,
  ownBarberProfileResultSchema,
  type CompleteBarberProfileRequest,
} from '@quicktrimr/validation';
import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { File } from 'expo-file-system';

import {
  EdgeFunctionError,
  invokeEdgeFunction,
} from '@/lib/api/invoke-edge-function';
import { supabaseEdgeTransport } from '@/lib/api/supabase-edge-transport';

const endpoint = 'complete-barber-profile';

async function accessToken(
  supabase: SupabaseClient,
  userId: string,
  signal?: AbortSignal,
) {
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== userId || signal?.aborted)
    throw new Error('Session changed.');
  return data.session.access_token;
}

async function request(
  supabase: SupabaseClient,
  userId: string,
  path: string,
  options: NonNullable<Parameters<SupabaseClient['functions']['invoke']>[1]>,
) {
  const token = await accessToken(supabase, userId, options.signal);
  const result = await supabase.functions.invoke<unknown>(
    `${endpoint}${path}`,
    {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    },
  );
  if (result.error instanceof FunctionsHttpError) {
    const response = result.error.context as Response;
    throw new EdgeFunctionError(
      response.status,
      errorResponseSchema.parse(await response.json()),
    );
  }
  if (result.error) throw result.error;
  return result.data;
}

export async function readBarberProfile(
  supabase: SupabaseClient,
  userId: string,
  signal: AbortSignal,
) {
  const result = await request(supabase, userId, '', { method: 'GET', signal });
  return ownBarberProfileResultSchema.parse(result);
}

export async function searchBarberServiceAreas(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  signal: AbortSignal,
) {
  const result = await request(supabase, userId, '/search', {
    body: { query },
    signal,
  });
  return barberAreaLookupResultSchema.parse(result).candidates;
}

export async function uploadBarberPhoto(
  supabase: SupabaseClient,
  userId: string,
  uri: string,
) {
  const body = await new File(uri).arrayBuffer();
  const result = await request(supabase, userId, '/photo', {
    body,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  return barberPhotoUploadResultSchema.parse(result).photoId;
}

export async function saveBarberProfile(
  supabase: SupabaseClient,
  userId: string,
  profile: CompleteBarberProfileRequest,
) {
  const token = await accessToken(supabase, userId);
  const result = await invokeEdgeFunction(
    supabaseEdgeTransport(supabase, token),
    endpoint,
    profile,
  );
  if (result.id !== userId) throw new Error('Unexpected barber profile.');
  return result;
}
