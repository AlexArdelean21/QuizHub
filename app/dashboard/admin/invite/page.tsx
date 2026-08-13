import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

/** Legacy route — invitations now live on the merged members page. */
export default function InvitePageRedirect() {
  redirect("/admin/join-requests")
}
