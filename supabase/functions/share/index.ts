// ─── share: open a document someone was sent a link to (migration 036) ───
//
// The person with the link has no account. The app's public page (/s) calls
// this with the project's public key and the link's secret, which is the
// only thing that matters: it is never stored, only its SHA-256, which
// open_document_share() — service role only, as it hands out a storage path
// — looks up. A link that has expired, been turned off, been opened 100
// times (050: each open hands out download addresses, and downloads are the
// organisation's 5 GB a month), or lost its document or its maker gets the
// same 404 as one that never existed, so the answer tells a guesser nothing.
//
// Answers:
//   200 { file_name, file_type, expires_at, shared_by, url, download_url }
//       Both addresses work for five minutes; opening the link again asks
//       again, and is counted again.
//   404 { status: 'gone' }   503 { status: 'needs_migration' } 036 is not applied
// ────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sha256Hex } from "../_shared/gmail-crypto.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const GONE = { status: "gone", error: "This link has expired, was turned off, or has been opened too many times. Ask whoever sent it for a new one." };
const SECRET = /^[0-9a-f]{64}$/;
const FIVE_MINUTES = 300;

interface Opened {
  storage_path: string;
  file_name: string;
  file_type: string;
  expires_at: string;
  shared_by: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json().catch(() => ({}));
    if (typeof token !== "string" || !SECRET.test(token)) return json(404, GONE);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase.rpc("open_document_share", {
      p_token_hash: await sha256Hex(new TextEncoder().encode(token)),
    });
    if (error) {
      if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
        return json(503, { status: "needs_migration", error: "Share links are not switched on yet." });
      }
      console.error("[share] open_document_share failed:", error.code, error.message);
      return json(500, { error: "Could not open this link. Please try again." });
    }
    const opened = ((data ?? []) as Opened[])[0];
    if (!opened) return json(404, GONE);

    const bucket = supabase.storage.from("documents");
    const [view, download] = await Promise.all([
      bucket.createSignedUrl(opened.storage_path, FIVE_MINUTES),
      bucket.createSignedUrl(opened.storage_path, FIVE_MINUTES, { download: opened.file_name }),
    ]);
    if (view.error || download.error || !view.data || !download.data) {
      console.error("[share] could not sign the file:", (view.error ?? download.error)?.message);
      return json(500, { error: "Could not open this link. Please try again." });
    }

    return json(200, {
      file_name: opened.file_name,
      file_type: opened.file_type,
      expires_at: opened.expires_at,
      shared_by: opened.shared_by,
      url: view.data.signedUrl,
      download_url: download.data.signedUrl,
    });
  } catch (err) {
    console.error("[share]", (err as Error).message);
    return json(500, { error: "Could not open this link. Please try again." });
  }
});
