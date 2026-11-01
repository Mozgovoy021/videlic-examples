// add a slug helper
export const MAX_SLUG_LENGTH = 64;

export function slugify(input: string, maxLength: number = MAX_SLUG_LENGTH): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug.length <= maxLength) {
    return slug;
  }
  return slug.slice(0, Math.max(0, maxLength)).replace(/-+$/, "");
}
