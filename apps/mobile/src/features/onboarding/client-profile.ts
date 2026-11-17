import { type CompleteClientProfileRequest } from '@quicktrimr/validation';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { invokeEdgeFunction } from '@/lib/api/invoke-edge-function';
import { supabaseEdgeTransport } from '@/lib/api/supabase-edge-transport';
import { mobileEnv } from '@/lib/env';

import type { SupabaseClient } from '@supabase/supabase-js';

const avatarBucket = 'client-avatars';
const draftOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const avatarPath = (userId: string) => `${userId}/avatar.jpg`;

export type ClientProfileDraft = {
  displayName: string;
  mobile: string;
  avatarUri: string | null;
};

const draftKey = (userId: string) => {
  const host = new URL(mobileEnv.supabaseUrl).host.replace(
    /[^a-zA-Z0-9._-]/g,
    '_',
  );
  return `quicktrimr-client-profile-${host}-${userId}`;
};

async function readDraft(userId: string): Promise<ClientProfileDraft | null> {
  const encoded = await SecureStore.getItemAsync(
    draftKey(userId),
    draftOptions,
  );
  if (!encoded) return null;
  const draft: unknown = JSON.parse(encoded);
  if (
    !draft ||
    typeof draft !== 'object' ||
    !('displayName' in draft) ||
    !('mobile' in draft) ||
    typeof draft.displayName !== 'string' ||
    typeof draft.mobile !== 'string'
  )
    return null;
  const uri =
    'avatarUri' in draft && typeof draft.avatarUri === 'string'
      ? draft.avatarUri
      : null;
  return {
    displayName: draft.displayName,
    mobile: draft.mobile,
    avatarUri: uri && new File(uri).exists ? uri : null,
  };
}

export function writeClientDraft(userId: string, draft: ClientProfileDraft) {
  return SecureStore.setItemAsync(
    draftKey(userId),
    JSON.stringify(draft),
    draftOptions,
  );
}

export function removeClientDraft(userId: string) {
  return SecureStore.deleteItemAsync(draftKey(userId), draftOptions);
}

export async function readClientProfile(
  supabase: SupabaseClient,
  userId: string,
  signal: AbortSignal,
) {
  const [draft, row] = await Promise.all([
    readDraft(userId),
    supabase
      .from('client_profiles')
      .select('display_name,mobile,avatar_path')
      .eq('id', userId)
      .abortSignal(signal)
      .maybeSingle(),
  ]);
  if (row.error) throw row.error;
  const displayName =
    typeof row.data?.display_name === 'string' ? row.data.display_name : '';
  const mobile = typeof row.data?.mobile === 'string' ? row.data.mobile : '';
  return {
    draft: draft ?? { displayName, mobile, avatarUri: null },
    saved: Boolean(displayName && mobile && !draft),
    hasAvatar: Boolean(row.data?.avatar_path),
  };
}

export async function saveClientProfile(
  supabase: SupabaseClient,
  userId: string,
  fields: CompleteClientProfileRequest,
  avatarUri: string | null,
) {
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== userId)
    throw new Error('Session changed.');
  if (avatarUri) {
    const bytes = await new File(avatarUri).arrayBuffer();
    const result = await supabase.storage
      .from(avatarBucket)
      .upload(avatarPath(userId), bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    if (result.error) throw new Error('Photo could not be saved.');
  }
  const result = await invokeEdgeFunction(
    supabaseEdgeTransport(supabase, data.session.access_token),
    'complete-client-profile',
    { ...fields, ...(avatarUri ? { attachAvatar: true as const } : {}) },
  );
  if (result.id !== userId) throw new Error('Unexpected client profile.');
  return result;
}
