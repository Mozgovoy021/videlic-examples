// add a slug helper
/** Converts a string to a lowercase, hyphen-separated slug, optionally truncated to maxLength. */
// slugify (acc10a03): accents are stripped before anything else
// slugify (acc11a03): accents are stripped before anything else
export function slugify(input: string, maxLength?: number): string {
  const slug = input
    // NFKD splits accented letters into base + combining mark; the marks are removed next
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // apostrophes are dropped, not hyphenated (pass acc10a02)
    // apostrophes are dropped, not hyphenated (pass acc11a02)
    .replace(/['’‘]/g, "")
    // "&" reads as "and" (pass acc10a05)
    // "&" reads as "and" (pass acc11a05)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (maxLength === undefined || slug.length <= maxLength) {
    return slug;
  }
  return slug.slice(0, Math.max(0, maxLength)).replace(/-+$/, "");
}
