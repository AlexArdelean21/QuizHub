export const NAME_UPDATED_EVENT = "quizhub:name-updated"

/**
 * Derives avatar initials: first letters of the first + last word of the name,
 * uppercased. Falls back to the first letter of the email, then "?".
 */
export function getInitials(
  name: string | null | undefined,
  email: string | null | undefined
): string {
  const trimmedName = (name ?? "").trim()
  if (trimmedName) {
    const parts = trimmedName.split(/\s+/).filter(Boolean)
    if (parts.length === 1) {
      return parts[0].slice(0, 1).toUpperCase()
    }
    const first = parts[0].slice(0, 1)
    const last = parts[parts.length - 1].slice(0, 1)
    return (first + last).toUpperCase()
  }
  const trimmedEmail = (email ?? "").trim()
  return trimmedEmail ? trimmedEmail.slice(0, 1).toUpperCase() : "?"
}
