import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SignupDocumentType = "termeni" | "confidentialitate";

interface RequestBody {
  userId: string;
  documents?: unknown;
  userAgent?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_DOCUMENTS = new Set<SignupDocumentType>([
  "termeni",
  "confidentialitate",
]);

/** Maximum age of a user account that qualifies for this route (15 minutes). */
const MAX_AGE_MS = 15 * 60 * 1000;

function parseDocuments(raw: unknown): SignupDocumentType[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: SignupDocumentType[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !ALLOWED_DOCUMENTS.has(item as SignupDocumentType)) {
      return null;
    }
    const typed = item as SignupDocumentType;
    if (!out.includes(typed)) out.push(typed);
  }
  return out.length > 0 ? out : null;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, userAgent } = body;
  const documents = parseDocuments(body.documents);

  if (!userId || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  if (!documents) {
    return NextResponse.json(
      {
        error:
          'documents is required and must be a non-empty array of "termeni" | "confidentialitate"',
      },
      { status: 400 }
    );
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    // SUPABASE_SERVICE_ROLE_KEY not configured — skip silently so signup isn't blocked
    console.warn("[record-signup-consent] SUPABASE_SERVICE_ROLE_KEY not set; skipping consent write.");
    return NextResponse.json({ success: true, skipped: true });
  }

  // Verify user exists and was created recently (prevents recording consent for arbitrary users)
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const createdAt = userData.user.created_at
    ? new Date(userData.user.created_at).getTime()
    : 0;
  const ageMs = Date.now() - createdAt;

  if (ageMs > MAX_AGE_MS) {
    return NextResponse.json(
      { error: "User account too old for this route" },
      { status: 403 }
    );
  }

  // Fetch current versions only for the document types the user accepted
  const { data: docs, error: docsError } = await admin
    .from("legal_documents")
    .select("type, version")
    .in("type", documents)
    .eq("is_current", true);

  if (docsError || !docs?.length) {
    console.error("[record-signup-consent] Could not fetch legal_documents:", docsError);
    return NextResponse.json({ error: "Could not fetch document versions" }, { status: 500 });
  }

  const rows = docs.map((doc) => ({
    user_id: userId,
    document_type: doc.type,
    document_version: doc.version,
    user_agent: userAgent ?? null,
  }));

  const { error: insertError } = await admin
    .from("user_consents")
    .upsert(rows, {
      onConflict: "user_id,document_type,document_version",
      ignoreDuplicates: true,
    });

  if (insertError) {
    console.error("[record-signup-consent] Insert failed:", insertError);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
