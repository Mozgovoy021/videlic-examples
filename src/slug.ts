// add a slug helper
/** Converts a string to a lowercase, hyphen-separated slug, optionally truncated to maxLength. */
export function slugify(input: string, maxLength?: number): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (maxLength === undefined || slug.length <= maxLength) {
    return slug;
  }
  return slug.slice(0, Math.max(0, maxLength)).replace(/-+$/, "");
}
