/**
 * REST resource: /v1/custom-fields
 *
 *   GET  /v1/custom-fields   list the organization's custom field definitions
 *   POST /v1/custom-fields   define a new custom field
 *
 * This is the schema behind `crm_contacts.custom_fields`: it tells a caller
 * which keys are valid, what type each expects and which values a select
 * accepts — without it, writing `custom_fields` is guesswork against an
 * unversioned blob.
 *
 * Creating is allowed; editing and deleting are not, and that asymmetry is
 * deliberate. A new definition reshapes nothing, because no contact carries the
 * key yet. Changing a type or removing a definition reinterprets or orphans the
 * value on every contact that already has one, so it stays in the dashboard
 * where the consequences are visible.
 */

import { ApiError, createResource, json } from '../_shared/rest-api.ts';

/** Mirrors crm_custom_field_defs_field_type_check. */
const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'datetime',
  'boolean',
  'select',
  'multi_select',
  'url',
  'email',
  'phone',
];

/**
 * The key is a JSON object key on every contact carrying the field, and it is
 * what expressions and merge variables reference — so keep it to a shape that
 * never needs quoting or escaping downstream.
 */
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;

const DEF_COLUMNS = [
  'id',
  'field_key',
  'display_name',
  'field_type',
  'options',
  'is_required',
  'validation_rules',
  'default_value',
  'description',
  'display_order',
  'is_visible_in_list',
  'is_searchable',
  'created_at',
  'updated_at',
].join(', ');

Deno.serve(createResource({
  GET: async ({ supabase, caller }) => {
    // Unpaginated on purpose: definitions are a handful per organization, and a
    // cursor here would be ceremony over a list you always want whole.
    const { data, error } = await supabase
      .from('crm_custom_field_defs')
      .select(DEF_COLUMNS)
      .eq('organization_id', caller.organization_id)
      .order('display_order', { ascending: true });

    if (error) throw new Error(error.message);

    return json({ success: true, data: data || [] });
  },

  POST: async ({ supabase, caller, body }) => {
    const fieldKey = typeof body.field_key === 'string' ? body.field_key.trim() : '';
    if (!FIELD_KEY_RE.test(fieldKey)) {
      throw new ApiError(
        'field_key is required: lowercase letters, digits and underscores, starting with a letter',
      );
    }

    const displayName =
      typeof body.display_name === 'string' && body.display_name.trim()
        ? body.display_name.trim()
        : fieldKey;

    const fieldType = typeof body.field_type === 'string' ? body.field_type : 'text';
    if (!FIELD_TYPES.includes(fieldType)) {
      throw new ApiError(`field_type must be one of: ${FIELD_TYPES.join(', ')}`);
    }

    // A select with nothing to select from is a text box with extra steps.
    const options = Array.isArray(body.options) ? body.options.map((o) => String(o)) : [];
    if ((fieldType === 'select' || fieldType === 'multi_select') && options.length === 0) {
      throw new ApiError(`field_type ${fieldType} requires a non-empty options[]`);
    }

    const { data, error } = await supabase
      .from('crm_custom_field_defs')
      .insert({
        organization_id: caller.organization_id,
        field_key: fieldKey,
        display_name: displayName,
        field_type: fieldType,
        options,
        is_required: body.is_required === true,
        default_value: typeof body.default_value === 'string' ? body.default_value : null,
        description: typeof body.description === 'string' ? body.description : null,
        display_order: typeof body.display_order === 'number' ? body.display_order : 0,
        is_visible_in_list: body.is_visible_in_list !== false,
        is_searchable: body.is_searchable !== false,
      })
      .select(DEF_COLUMNS)
      .single();

    if (error) {
      // (organization_id, field_key) is unique — say so rather than leaking the
      // constraint name, and make the fix obvious.
      if (error.code === '23505') {
        throw new ApiError(`A custom field with key "${fieldKey}" already exists`, 409);
      }
      throw new Error(error.message);
    }

    return json({ success: true, data }, 201);
  },
}));
