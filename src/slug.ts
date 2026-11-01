// add a slug helper
export function slugify(input: string, maxLength?: number): string {
  if (input.trim().length === 0) {
    return "";
  }
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
