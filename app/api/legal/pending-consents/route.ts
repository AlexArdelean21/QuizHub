import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPendingConsents, hasAnyPriorConsent } from "@/lib/legal/check-pending-consents";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ pending: [] }, { status: 200 });
  }

  const [pending, hadPriorConsent] = await Promise.all([
    getPendingConsents(user.id),
    hasAnyPriorConsent(user.id),
  ]);
  return NextResponse.json(
    { pending, userId: user.id, isFirstConsent: !hadPriorConsent },
    { status: 200 }
  );
}
