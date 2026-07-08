import { cn } from "@/lib/utils"

const SIZE_CLASSES: Record<"sm" | "md" | "lg", string> = {
  sm: "size-9 text-xs",
  md: "size-11 text-base",
  lg: "size-16 text-xl",
}

export function ProfileAvatar({
  initials,
  size = "md",
  avatarUrl,
}: {
  initials: string
  size?: "sm" | "md" | "lg"
  /**
   * Future-proofing for real photo uploads: pass a URL here and it renders an
   * <img> in place of the initials. Adding this optional prop is the only
   * change a call site will ever need — the API is otherwise stable.
   */
  avatarUrl?: string | null
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-600 font-semibold text-white",
        SIZE_CLASSES[size]
      )}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  )
}
