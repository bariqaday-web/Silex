import { supabase } from "@/lib/supabase";

/** Returns merchant IDs that currently have at least one unexpired story. */
export async function getActiveStoryMerchantIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("stories")
    .select("merchant_id")
    .gt("expires_at", new Date().toISOString());

  if (error) {
    console.error("Failed to load active stories:", error);
    return new Set();
  }

  return new Set((data ?? []).map(({ merchant_id }) => merchant_id));
}
