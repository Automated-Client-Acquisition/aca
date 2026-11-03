// Shared utilities for CRM custom field definitions (crm_custom_field_defs).
// Used by CSV import mapping and the Settings > Custom Fields manager so
// field_key generation stays identical everywhere it's created.

/** System keys written into crm_contacts.custom_fields by other features
 * that are NOT user-managed custom fields — never list/delete these via
 * the custom fields UI. */
export const CUSTOM_FIELD_SYSTEM_KEYS = new Set<string>([
  "keyword_excluded",
]);

export function sanitizeFieldKey(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
