/** Convert a string to a URL-safe slug */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Generate the npx install command for a skill */
export function getSkillInstallCommand(orgSlug: string, skillSlug: string): string {
  return `npx add-skill ${orgSlug}/${skillSlug}`;
}
