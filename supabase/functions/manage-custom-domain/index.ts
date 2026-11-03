import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
// Use Vercel SDK for multi-tenant domain management
// See: https://vercel.com/docs/multi-tenant/domain-management
import { VercelCore } from "npm:@vercel/sdk@1/core.js";
import { projectsAddProjectDomain } from "npm:@vercel/sdk@1/funcs/projectsAddProjectDomain.js";
import { projectsGetProjectDomain } from "npm:@vercel/sdk@1/funcs/projectsGetProjectDomain.js";
import { projectsVerifyProjectDomain } from "npm:@vercel/sdk@1/funcs/projectsVerifyProjectDomain.js";
import { projectsRemoveProjectDomain } from "npm:@vercel/sdk@1/funcs/projectsRemoveProjectDomain.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

interface VercelDomainResponse {
  name: string;
  apexName: string;
  projectId: string;
  verified: boolean;
  verification?: {
    type: string;
    domain: string;
    value: string;
    reason: string;
  }[];
  configuredBy?: string;
  acceptedChallenges?: string[];
  gitBranch?: string | null;
  updatedAt?: number;
  createdAt?: number;
}

/**
 * Common multi-part TLDs where registrations happen at the third level.
 * Covers ~95% of real-world usage. Sorted by popularity/region.
 */
const MULTI_PART_TLDS = [
  // United Kingdom
  'co.uk', 'org.uk', 'net.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  // Australia
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  // Brazil
  'com.br', 'net.br', 'org.br', 'edu.br', 'gov.br',
  // Japan
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  // India
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in',
  // South Korea
  'co.kr', 'or.kr', 'ne.kr', 'ac.kr', 'go.kr',
  // New Zealand
  'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'govt.nz',
  // South Africa
  'co.za', 'org.za', 'net.za', 'ac.za', 'gov.za', 'web.za',
  // Mexico & Latin America
  'com.mx', 'org.mx', 'net.mx', 'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.cl', 'com.ec', 'com.uy',
  // Asia-Pacific
  'com.tw', 'org.tw', 'com.hk', 'org.hk', 'com.sg', 'org.sg', 'com.my', 'org.my',
  'com.ph', 'com.pk', 'com.bd', 'com.np', 'com.vn', 'com.cn', 'com.lk',
  // Indonesia
  'co.id', 'or.id', 'web.id', 'ac.id', 'go.id',
  // Thailand
  'co.th', 'or.th', 'ac.th', 'go.th', 'in.th',
  // Africa
  'com.ng', 'org.ng', 'com.eg', 'com.gh', 'co.ke', 'co.tz', 'co.ug', 'co.zw',
  // Middle East
  'com.tr', 'org.tr', 'net.tr', 'com.sa', 'com.ae', 'co.il',
  // Europe
  'com.ua', 'org.ua', 'co.hu', 'com.pl', 'com.ro', 'com.gr', 'com.pt',
  // Israel
  'org.il', 'net.il', 'ac.il',
];

/** Detect apex domains, accounting for common multi-part TLDs (.co.uk, .com.au, etc.) */
function isApexDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  for (const tld of MULTI_PART_TLDS) {
    if (lower.endsWith('.' + tld)) {
      const prefix = lower.slice(0, -(tld.length + 1));
      return !prefix.includes('.');
    }
  }
  return domain.split('.').length <= 2;
}

/** Extract the subdomain prefix for CNAME records (e.g., "app.staging" from "app.staging.example.com") */
function getSubdomainPrefix(domain: string): string {
  const lower = domain.toLowerCase();
  for (const tld of MULTI_PART_TLDS) {
    if (lower.endsWith('.' + tld)) {
      return lower.slice(0, -(tld.length + 1));
    }
  }
  return lower.split('.').slice(0, -2).join('.');
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get Vercel configuration
    const vercelToken = Deno.env.get('VERCEL_TOKEN');
    const vercelTeamId = Deno.env.get('VERCEL_TEAM_ID');
    const vercelProjectId = Deno.env.get('VERCEL_PROJECT_ID');

    if (!vercelToken || !vercelProjectId) {
      return new Response(JSON.stringify({
        error: 'Vercel integration not configured',
        message: 'Contact support to enable custom domains',
      }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Vercel SDK client
    const vercel = new VercelCore({
      bearerToken: vercelToken,
    });

    const url = new URL(req.url);
    const method = req.method;

    // Route based on method
    switch (method) {
      case 'POST': {
        // Add a new domain
        const body = await req.json();
        const { domain, organizationId } = body;

        if (!domain || !organizationId) {
          return new Response(JSON.stringify({ error: 'Missing domain or organizationId' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Verify user has permission for this organization
        const { data: membership } = await supabase
          .from('organization_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('organization_id', organizationId)
          .maybeSingle();

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
          return new Response(JSON.stringify({ error: 'Permission denied' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        try {
          // Add domain to Vercel using SDK
          // See: https://vercel.com/docs/multi-tenant/domain-management
          const addResult = await projectsAddProjectDomain(vercel, {
            idOrName: vercelProjectId,
            teamId: vercelTeamId || undefined,
            requestBody: {
              name: domain,
            },
          });

          if (!addResult.ok) {
            const errorBody = addResult.error;
            console.error('Vercel SDK error:', errorBody);

            // Handle domain already exists
            if (errorBody?.code === 'domain_already_in_use' || errorBody?.code === 'domain_already_exists') {
              return new Response(JSON.stringify({
                error: 'Domain already in use',
                message: 'This domain is already configured on another Vercel project. The owner needs to verify ownership via TXT record.',
              }), {
                status: 409,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }

            return new Response(JSON.stringify({
              error: 'Failed to add domain to Vercel',
              details: errorBody,
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const vercelData = addResult.value;

          // Determine DNS instructions based on domain type
          const dnsInstructions = isApexDomain(domain)
            ? {
                type: 'A',
                name: '@',
                value: '76.76.21.21',
                note: 'For apex domains, add an A record pointing to 76.76.21.21',
              }
            : {
                type: 'CNAME',
                name: getSubdomainPrefix(domain),
                value: 'cname.vercel-dns.com',
                note: 'For subdomains, add a CNAME record pointing to cname.vercel-dns.com',
              };

          // Update domain record in database
          const { error: updateError } = await supabase
            .from('organization_domains')
            .update({
              vercel_domain_id: vercelData.name,
              vercel_project_id: vercelProjectId,
              verification_status: vercelData.verified ? 'verified' : 'pending',
              ssl_status: vercelData.verified ? 'active' : 'pending',
              updated_at: new Date().toISOString(),
            })
            .eq('organization_id', organizationId)
            .eq('domain', domain);

          if (updateError) {
            console.error('Database update error:', updateError);
          }

          return new Response(JSON.stringify({
            success: true,
            domain: vercelData.name,
            verified: vercelData.verified,
            verification: vercelData.verification,
            dnsInstructions,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('Vercel SDK error:', error);
          return new Response(JSON.stringify({
            error: 'Failed to add domain',
            message: error instanceof Error ? error.message : 'Unknown error',
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      case 'GET': {
        // Check domain verification status
        const domain = url.searchParams.get('domain');
        const organizationId = url.searchParams.get('organizationId');

        if (!domain || !organizationId) {
          return new Response(JSON.stringify({ error: 'Missing domain or organizationId' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Verify user has permission
        const { data: membership } = await supabase
          .from('organization_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('organization_id', organizationId)
          .maybeSingle();

        if (!membership) {
          return new Response(JSON.stringify({ error: 'Permission denied' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        try {
          // Get domain status and trigger verification using SDK
          const [domainResult, verifyResult] = await Promise.all([
            projectsGetProjectDomain(vercel, {
              idOrName: vercelProjectId,
              teamId: vercelTeamId || undefined,
              domain,
            }),
            projectsVerifyProjectDomain(vercel, {
              idOrName: vercelProjectId,
              teamId: vercelTeamId || undefined,
              domain,
            }),
          ]);

          if (!domainResult.ok) {
            return new Response(JSON.stringify({
              error: 'Failed to check domain status',
              details: domainResult.error,
            }), {
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const vercelData = domainResult.value as VercelDomainResponse;
          const isVerified = verifyResult.ok && verifyResult.value?.verified;

          // Update database with latest status
          const newStatus = isVerified ? 'verified' : 'pending';
          const { error: updateError } = await supabase
            .from('organization_domains')
            .update({
              verification_status: newStatus,
              verified_at: isVerified ? new Date().toISOString() : null,
              ssl_status: isVerified ? 'active' : 'pending',
              dns_configured: isVerified,
              last_verification_attempt: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('organization_id', organizationId)
            .eq('domain', domain);

          if (updateError) {
            console.error('Database update error:', updateError);
          }

          return new Response(JSON.stringify({
            domain: vercelData.name,
            verified: isVerified,
            verification: vercelData.verification,
            configuredBy: vercelData.configuredBy,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('Vercel SDK error:', error);
          return new Response(JSON.stringify({
            error: 'Failed to check domain',
            message: error instanceof Error ? error.message : 'Unknown error',
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      case 'DELETE': {
        // Remove domain — support both JSON body and query params for resilience
        let domain: string | null = null;
        let organizationId: string | null = null;
        const contentType = req.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          try {
            const body = await req.json();
            domain = body.domain;
            organizationId = body.organizationId;
          } catch { /* fall through to query params */ }
        }
        if (!domain || !organizationId) {
          domain = url.searchParams.get('domain');
          organizationId = url.searchParams.get('organizationId');
        }

        if (!domain || !organizationId) {
          return new Response(JSON.stringify({ error: 'Missing domain or organizationId' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Verify user has permission
        const { data: membership } = await supabase
          .from('organization_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('organization_id', organizationId)
          .maybeSingle();

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
          return new Response(JSON.stringify({ error: 'Permission denied' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        try {
          // Remove domain from Vercel using SDK
          const removeResult = await projectsRemoveProjectDomain(vercel, {
            idOrName: vercelProjectId,
            teamId: vercelTeamId || undefined,
            domain,
          });

          // Domain removed (or didn't exist - both are fine)
          if (!removeResult.ok && removeResult.error?.code !== 'not_found') {
            console.error('Vercel SDK error:', removeResult.error);
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'Domain removed successfully',
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('Vercel SDK error:', error);
          return new Response(JSON.stringify({
            error: 'Failed to remove domain',
            message: error instanceof Error ? error.message : 'Unknown error',
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      default:
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

  } catch (error) {
    console.error('Error in manage-custom-domain:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
