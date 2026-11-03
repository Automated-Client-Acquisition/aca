import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { fromAddress } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ExportRequest {
  email: string;
  format: "csv" | "json";
  columns?: string[];
  contactIds?: string[];
  filters?: {
    status?: string;
    source?: string;
    contactType?: string;
    search?: string;
    linkedinOnly?: boolean;
  };
}

interface Contact {
  id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  company: string | null;
  job_title: string | null;
  primary_linkedin_url: string | null;
  tags: string[];
  status: string;
  source: string | null;
  contact_type: string | null;
  lead_score: number;
  city: string | null;
  state: string | null;
  country: string | null;
  company_website: string | null;
  is_linkedin_connection: boolean;
  first_seen_at: string;
  last_activity_at: string;
  created_at: string;
  enrichment_data: Record<string, unknown> | null;
  custom_fields: Record<string, unknown> | null;
}

const PAGE_SIZE = 1000;
const IN_CHUNK_SIZE = 200;

const EXPORT_COLUMNS = [
  { key: "display_name", label: "Name" },
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "primary_email", label: "Email" },
  { key: "primary_phone", label: "Phone" },
  { key: "company", label: "Company" },
  { key: "job_title", label: "Job Title" },
  { key: "primary_linkedin_url", label: "LinkedIn URL" },
  { key: "company_website", label: "Website" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },
  { key: "tags", label: "Tags" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
  { key: "contact_type", label: "Type" },
  { key: "lead_score", label: "Lead Score" },
  { key: "is_linkedin_connection", label: "LinkedIn Connection" },
  { key: "first_seen_at", label: "First Seen" },
  { key: "last_activity_at", label: "Last Activity" },
  { key: "created_at", label: "Created At" },
  // Enrichment data columns
  { key: "enrichment_industry", label: "Industry" },
  { key: "enrichment_company_size", label: "Company Size" },
  { key: "enrichment_seniority", label: "Seniority" },
  { key: "enrichment_department", label: "Department" },
  { key: "enrichment_technologies", label: "Technologies" },
  { key: "enrichment_email_verified", label: "Email Verified" },
  { key: "enrichment_email_confidence", label: "Email Confidence" },
];

// Helper to extract enrichment data values
function getEnrichmentValue(contact: Contact, key: string): unknown {
  const enrichment = contact.enrichment_data;
  if (!enrichment) return null;

  switch (key) {
    case "enrichment_industry":
      return (enrichment.company as Record<string, unknown>)?.industry;
    case "enrichment_company_size":
      return (enrichment.company as Record<string, unknown>)?.size;
    case "enrichment_seniority":
      return enrichment.seniority;
    case "enrichment_department":
      return enrichment.department;
    case "enrichment_technologies":
      return (enrichment.company as Record<string, unknown>)?.technologies;
    case "enrichment_email_verified":
      return enrichment.emailVerified;
    case "enrichment_email_confidence":
      return enrichment.emailConfidence;
    default:
      return null;
  }
}

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // If contains comma, newline, or quote, wrap in quotes and escape internal quotes
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Builds the full column list for this export: static EXPORT_COLUMNS plus any
// selected custom_<field_key> columns, labeled from the org's field definitions
// (falling back to a formatted key if a def was since deleted).
function resolveColumnsToExport(
  selectedColumns: string[] | undefined,
  customFieldLabels: Map<string, string>
): Array<{ key: string; label: string }> {
  if (!selectedColumns) return EXPORT_COLUMNS;
  const staticCols = EXPORT_COLUMNS.filter((col) => selectedColumns.includes(col.key));
  const customCols = selectedColumns
    .filter((key) => key.startsWith("custom_") && !EXPORT_COLUMNS.some((c) => c.key === key))
    .map((key) => {
      const fieldKey = key.slice("custom_".length);
      const label = customFieldLabels.get(fieldKey) ||
        fieldKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return { key, label };
    });
  return [...staticCols, ...customCols];
}

function getColumnValue(contact: Contact, key: string): unknown {
  if (key.startsWith("enrichment_")) return getEnrichmentValue(contact, key);
  if (key.startsWith("custom_")) return contact.custom_fields?.[key.slice("custom_".length)];
  return (contact as unknown as Record<string, unknown>)[key];
}

function generateCSV(
  contacts: Contact[],
  selectedColumns: string[] | undefined,
  customFieldLabels: Map<string, string>
): string {
  const columnsToExport = resolveColumnsToExport(selectedColumns, customFieldLabels);

  const headers = columnsToExport.map((col) => col.label);
  const rows = contacts.map((contact) =>
    columnsToExport.map((col) => escapeCSV(formatValue(getColumnValue(contact, col.key))))
  );

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

function generateJSON(
  contacts: Contact[],
  selectedColumns: string[] | undefined,
  customFieldLabels: Map<string, string>
): string {
  const columnsToExport = resolveColumnsToExport(selectedColumns, customFieldLabels);

  const exportData = {
    export_date: new Date().toISOString(),
    total_records: contacts.length,
    columns_exported: columnsToExport.map((col) => col.label),
    contacts: contacts.map((contact) => {
      const obj: Record<string, unknown> = {};
      for (const col of columnsToExport) {
        obj[col.key] = getColumnValue(contact, col.key);
      }
      return obj;
    }),
  };
  return JSON.stringify(exportData, null, 2);
}

function applyExportFilters(query: any, filters: ExportRequest["filters"] | undefined) {
  if (filters?.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters?.source && filters.source !== "all" && filters.source !== "linkedin_connection") {
    query = query.eq("source", filters.source);
  }
  if (filters?.linkedinOnly || filters?.source === "linkedin_connection") {
    query = query.eq("is_linkedin_connection", true);
  }
  if (filters?.contactType && filters.contactType !== "all") {
    query = query.eq("contact_type", filters.contactType);
  }
  if (filters?.search) {
    const sanitized = filters.search.replace(/[%,]/g, " ").trim();
    if (sanitized) {
      const searchFilter = `display_name.ilike.%${sanitized}%,primary_email.ilike.%${sanitized}%,company.ilike.%${sanitized}%`;
      query = query.or(searchFilter);
    }
  }
  return query;
}

async function fetchContactsForExport(
  serviceClient: { from: (table: string) => any },
  organizationId: string,
  contactIds: string[] | undefined,
  filters: ExportRequest["filters"] | undefined,
): Promise<{ contacts: Contact[]; error: unknown | null }> {
  const contacts: Contact[] = [];

  if (contactIds && contactIds.length > 0) {
    const uniqueIds = Array.from(new Set(contactIds));
    for (let i = 0; i < uniqueIds.length; i += IN_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + IN_CHUNK_SIZE);
      const { data, error } = await serviceClient
        .from("crm_contacts")
        .select("*")
        .eq("organization_id", organizationId)
        .in("id", chunk)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (error) return { contacts: [], error };
      contacts.push(...((data ?? []) as Contact[]));
    }
    return { contacts, error: null };
  }

  let from = 0;
  while (true) {
    let query = serviceClient
      .from("crm_contacts")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    query = applyExportFilters(query, filters);
    const { data, error } = await query;
    if (error) return { contacts: [], error };

    const rows = (data ?? []) as Contact[];
    contacts.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { contacts, error: null };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    // Get the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client for auth verification
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service client for database operations
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get request body
    const { email, format, columns, contactIds, filters }: ExportRequest = await req.json();

    if (!email || !format) {
      return new Response(
        JSON.stringify({ error: "Email and format are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's organization
    const { data: userData, error: userDataError } = await serviceClient
      .from("users")
      .select("organization_id, active_organization_id")
      .eq("id", user.id)
      .single();

    if (userDataError || !userData) {
      return new Response(
        JSON.stringify({ error: "User organization not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const organizationId = userData.active_organization_id || userData.organization_id;

    const { contacts, error: contactsError } = await fetchContactsForExport(
      serviceClient,
      organizationId,
      contactIds,
      filters,
    );

    if (contactsError) {
      console.error("Contacts fetch error:", contactsError);
      const detail =
        typeof contactsError === "object" && contactsError !== null
          ? (contactsError as { message?: string; code?: string; details?: string; hint?: string })
          : { message: String(contactsError) };
      return new Response(
        JSON.stringify({
          error: "Failed to fetch contacts",
          detail: detail.message,
          code: detail.code,
          details: detail.details,
          hint: detail.hint,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!contacts || contacts.length === 0) {
      return new Response(
        JSON.stringify({ error: "No contacts to export" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve custom field display names (for CSV/JSON column headers)
    const { data: customFieldDefs } = await serviceClient
      .from("crm_custom_field_defs")
      .select("field_key, display_name")
      .eq("organization_id", organizationId);
    const customFieldLabels = new Map<string, string>(
      (customFieldDefs || []).map((f: { field_key: string; display_name: string }) => [f.field_key, f.display_name])
    );

    // Generate export content
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `contacts_export_${timestamp}.${format}`;
    const content = format === "csv"
      ? generateCSV(contacts, columns, customFieldLabels)
      : generateJSON(contacts, columns, customFieldLabels);
    const mimeType = format === "csv" ? "text/csv" : "application/json";
    const columnCount = columns?.length || EXPORT_COLUMNS.length;

    // Convert to base64 for attachment
    const base64Content = btoa(unescape(encodeURIComponent(content)));

    // Build email HTML
    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333; border-bottom: 2px solid #10b981; padding-bottom: 10px;">
          Your Contacts Export is Ready
        </h2>

        <div style="background: #f0fdf4; border: 2px solid #10b981; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0; font-size: 16px; color: #166534;">
            <strong>${contacts.length.toLocaleString()}</strong> contacts exported successfully
          </p>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">
            Format: ${format.toUpperCase()} | ${columnCount} columns | Generated: ${new Date().toLocaleString()}
          </p>
        </div>

        <p style="color: #374151; line-height: 1.6;">
          Your contacts export is attached to this email. You can open ${format.toUpperCase()} files with:
        </p>

        ${format === "csv" ? `
        <ul style="color: #374151; line-height: 1.8;">
          <li>Microsoft Excel</li>
          <li>Google Sheets</li>
          <li>Numbers (Mac)</li>
          <li>Any spreadsheet application</li>
        </ul>
        ` : `
        <ul style="color: #374151; line-height: 1.8;">
          <li>Any text editor</li>
          <li>Visual Studio Code</li>
          <li>Import into your CRM or database</li>
        </ul>
        `}

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">
          <p style="margin: 0;">Sent from ACA</p>
        </div>
      </div>
    `;

    // Send email via Resend with attachment
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress("exports"),
        to: [email],
        subject: `Your Contacts Export (${contacts.length.toLocaleString()} contacts)`,
        html: emailHtml,
        attachments: [
          {
            filename: filename,
            content: base64Content,
            type: mimeType,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Resend API error:", errorData);
      throw new Error(`Failed to send email: ${response.status}`);
    }

    const result = await response.json();
    console.log("Export email sent:", result);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Export sent to ${email}`,
        contactCount: contacts.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in export-contacts-email:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
