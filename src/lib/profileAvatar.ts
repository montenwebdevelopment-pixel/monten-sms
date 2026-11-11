import { supabase } from "./supabase";

export const PROFILE_AVATAR_BUCKET = "avatars";
export const PROFILE_AVATAR_MAX_SIZE = 5 * 1024 * 1024;

const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function getProfileAvatarUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return supabase.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(value).data.publicUrl;
}

export function isOwnedProfileAvatar(value: string | null | undefined, userId: string): value is string {
  return Boolean(value?.startsWith(`${userId}/`));
}

export async function uploadProfileAvatar(userId: string, file: File): Promise<string> {
  const extension = imageExtensions[file.type];
  if (!extension) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }
  if (file.size === 0 || file.size > PROFILE_AVATAR_MAX_SIZE) {
    throw new Error("Choose an image smaller than 5 MB.");
  }

  const objectPath = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from(PROFILE_AVATAR_BUCKET)
    .upload(objectPath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
  if (error) throw error;
  return objectPath;
}

export async function removeProfileAvatar(userId: string, value: string | null | undefined): Promise<void> {
  if (!isOwnedProfileAvatar(value, userId)) return;
  const { error } = await supabase.storage.from(PROFILE_AVATAR_BUCKET).remove([value]);
  if (error) throw error;
}
