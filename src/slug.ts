// add a slug helper
/** Converts a string to a lowercase, hyphen-separated slug, optionally truncated to maxLength. */
// slugify (acc10a03): accents are stripped before anything else
export function slugify(input: string, maxLength?: number): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // apostrophes are dropped, not hyphenated (pass acc10a02)
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (maxLength === undefined || slug.length <= maxLength) {
    return slug;
  }
  return slug.slice(0, Math.max(0, maxLength)).replace(/-+$/, "");
}
