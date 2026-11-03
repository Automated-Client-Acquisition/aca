import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, authenticateRequest, unauthorized } from "../_shared/cli-auth.ts";
import { hostedOnlyResponse } from "../_shared/site-config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// Configuration
// ============================================================================

// Plan mapping: Skool plan -> ACA tier
// Priority order matters - higher tier wins if member is in multiple communities
const PLAN_TIER_PRIORITY = ['free', 'pro', 'enterprise'] as const;

// Default plan mapping (can be overridden per community in database)
const DEFAULT_PLAN_MAPPING = {
  free_zapier_invite: 'enterprise',
  yearly: 'enterprise',
  monthly_67: 'pro',
  monthly_49: 'pro',
  monthly_1: 'free',
};

interface SkoolCommunity {
  id: string;
  slug: string;
  group_id: string;
  name: string;
  is_active: boolean;
  plan_mapping: typeof DEFAULT_PLAN_MAPPING;
}

// ============================================================================
// Types
// ============================================================================

interface SkoolMember {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email?: string;
  member: {
    id: string;
    userId: string;
    groupId: string;
    role: string;
    approvedAt?: string;
    churned?: string;
    billingProductId?: string;
    metadata?: {
      mbme?: string;      // Member email
      mmbp?: string;      // Membership billing plan (JSON string)
      mbsltv?: number;    // Lifetime value in cents
      mbscpe?: number;    // Subscription current period end (Unix timestamp)
      msbs?: string;      // Stripe subscription ID
      leftAt?: number;    // Unix timestamp when they left
    };
  };
}

interface MemberPlanInfo {
  email: string;
  skoolUserId: string;
  tier: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'cancelling' | 'churned';
  planDetails: {
    amount?: number;
    interval?: string;
    source: string;
  };
}

interface SyncResult {
  synced: number;
  upgraded: number;
  downgraded: number;
  churned: number;
  notFound: number;
  errors: number;
}

// ============================================================================
// Plan Detection Logic
// ============================================================================

function determineAcaTier(member: SkoolMember): 'free' | 'pro' | 'enterprise' {
  const metadata = member.member?.metadata || {};
  const mmbpRaw = metadata.mmbp;
  const hasStripeSubscription = !!metadata.msbs;
  const hasBillingProduct = !!member.member?.billingProductId;
  const role = member.member?.role;

  // If churned or declined, they lose access
  if (role === 'declined' || member.member?.churned) {
    return 'free';
  }

  // Parse the membership billing plan if available
  if (mmbpRaw) {
    try {
      const plan = JSON.parse(mmbpRaw);
      const amount = plan.amount || 0; // in cents
      const interval = plan.recurring_interval;

      // Yearly subscription -> enterprise (unlimited)
      if (interval === 'year') {
        return 'enterprise';
      }

      // $67/month or $49/month -> pro
      if (interval === 'month' && (amount === 6700 || amount === 4900)) {
        return 'pro';
      }

      // $1/month -> free
      if (interval === 'month' && amount === 100) {
        return 'free';
      }

      // Any other paid monthly plan, default based on amount
      if (interval === 'month' && amount > 100) {
        return 'pro';
      }
    } catch (e) {
      console.error('Failed to parse mmbp:', e);
    }
  }

  // Free members invited via Zapier (no billing, but active member) -> enterprise
  if (!hasStripeSubscription && !hasBillingProduct && role === 'member') {
    return 'enterprise';
  }

  // Has billing product but no subscription data - check lifetime value
  if (hasBillingProduct && !hasStripeSubscription) {
    const ltv = metadata.mbsltv || 0;
    // $67 or $49 one-time purchase
    if (ltv >= 4900) {
      return 'pro';
    }
  }

  // Default: if they're an active member with no billing info, assume external payment
  if (role === 'member' || role === 'admin' || role === 'owner') {
    return 'enterprise';
  }

  return 'free';
}

function getMemberStatus(member: SkoolMember): 'active' | 'cancelling' | 'churned' {
  const role = member.member?.role;

  if (member.member?.churned || role === 'declined') {
    return 'churned';
  }

  // Note: Skool's cancelling status would need to be detected from the tab
  // For now, if they're in the data, they're either active or churned
  return 'active';
}

function extractMemberEmail(member: SkoolMember): string | null {
  // First try the metadata email field
  const mbme = member.member?.metadata?.mbme;
  if (mbme) return mbme;

  // Then try the top-level email
  if (member.email) return member.email;

  return null;
}

// ============================================================================
// Skool API Client
// ============================================================================

class SkoolClient {
  private cookies: string = '';
  private buildId: string = '';

  constructor(private email: string, private password: string) {}

  async login(): Promise<boolean> {
    console.log('🔐 [Skool] Logging in...');

    const response = await fetch('https://api2.skool.com/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });

    if (!response.ok) {
      console.error('❌ [Skool] Login failed:', response.status);
      return false;
    }

    // Capture cookies from response
    const setCookies = response.headers.getSetCookie?.() || [];
    this.cookies = setCookies.map(c => c.split(';')[0]).join('; ');

    console.log('✅ [Skool] Login successful');
    return true;
  }

  async getBuildId(groupSlug: string): Promise<string> {
    if (this.buildId) return this.buildId;

    const response = await fetch(`https://www.skool.com/${groupSlug}`, {
      headers: {
        'Cookie': this.cookies,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    const html = await response.text();
    const match = html.match(/_next\/static\/([^/]+)\/_buildManifest\.js/);

    if (match) {
      this.buildId = match[1];
      console.log('📦 [Skool] Found buildId:', this.buildId);
    }

    return this.buildId;
  }

  async getMembers(groupSlug: string, tab: 'active' | 'churned' | 'cancelling' = 'active'): Promise<SkoolMember[]> {
    const buildId = await this.getBuildId(groupSlug);
    if (!buildId) {
      throw new Error('Could not get Skool buildId');
    }

    const allMembers: SkoolMember[] = [];
    let page = 1;
    const maxPages = 100; // Safety limit to prevent infinite loops

    console.log(`📋 [Skool] Fetching ${tab} members from ${groupSlug}...`);

    while (page <= maxPages) {
      const url = `https://www.skool.com/_next/data/${buildId}/${groupSlug}/-/members.json`;
      const params = new URLSearchParams({
        t: tab,
        group: groupSlug,
        p: String(page),
      });

      const response = await fetch(`${url}?${params}`, {
        headers: {
          'Cookie': this.cookies,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch members: ${response.status}`);
      }

      const data = await response.json();
      const users = data?.pageProps?.users || [];

      if (users.length === 0) {
        // No more members on this page, we've fetched all
        break;
      }

      allMembers.push(...users);
      console.log(`  📄 [Skool] Page ${page}: ${users.length} members (total: ${allMembers.length})`);

      // Skool returns 30 per page - if we got fewer, we're on the last page
      if (users.length < 30) {
        break;
      }

      page++;
      // Small delay between page requests to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`✅ [Skool] Found ${allMembers.length} ${tab} members in ${groupSlug} (${page} pages)`);
    return allMembers;
  }

  async getAllMembers(groupSlug: string): Promise<{ active: SkoolMember[], churned: SkoolMember[], cancelling: SkoolMember[] }> {
    // Add small delays between requests to avoid rate limiting
    const active = await this.getMembers(groupSlug, 'active');
    await new Promise(r => setTimeout(r, 1000));

    const churned = await this.getMembers(groupSlug, 'churned');
    await new Promise(r => setTimeout(r, 1000));

    const cancelling = await this.getMembers(groupSlug, 'cancelling');

    return { active, churned, cancelling };
  }
}

// ============================================================================
// Sync Logic
// ============================================================================

async function syncMemberships(supabase: any, skoolClient: SkoolClient): Promise<SyncResult> {
  const result: SyncResult = {
    synced: 0,
    upgraded: 0,
    downgraded: 0,
    churned: 0,
    notFound: 0,
    errors: 0,
  };

  // Fetch active communities from database
  const { data: communities, error: communitiesError } = await supabase
    .from('skool_communities')
    .select('*')
    .eq('is_active', true);

  if (communitiesError) {
    throw new Error(`Failed to fetch Skool communities: ${communitiesError.message}`);
  }

  if (!communities || communities.length === 0) {
    console.log('⚠️ [Sync] No active Skool communities configured');
    return result;
  }

  console.log(`📋 [Sync] Found ${communities.length} active communities to sync`);

  // Collect all member info across communities
  const memberPlans = new Map<string, MemberPlanInfo>();

  for (const community of communities as SkoolCommunity[]) {
    console.log(`\n🔄 [Sync] Processing community: ${community.slug} (${community.name})`);

    try {
      const { active, churned, cancelling } = await skoolClient.getAllMembers(community.slug);

      // Process active members
      for (const member of active) {
        const email = extractMemberEmail(member);
        if (!email) continue;

        const tier = determineAcaTier(member);
        const existing = memberPlans.get(email.toLowerCase());

        // Keep the highest tier if member is in multiple communities
        if (!existing || PLAN_TIER_PRIORITY.indexOf(tier) > PLAN_TIER_PRIORITY.indexOf(existing.tier)) {
          memberPlans.set(email.toLowerCase(), {
            email: email.toLowerCase(),
            skoolUserId: member.id,
            tier,
            status: 'active',
            planDetails: {
              source: community.slug,
              amount: member.member?.metadata?.mmbp ? JSON.parse(member.member.metadata.mmbp).amount : undefined,
              interval: member.member?.metadata?.mmbp ? JSON.parse(member.member.metadata.mmbp).recurring_interval : undefined,
            },
          });
        }
      }

      // Process cancelling members (keep current tier for grace period)
      for (const member of cancelling) {
        const email = extractMemberEmail(member);
        if (!email) continue;

        const existing = memberPlans.get(email.toLowerCase());
        if (!existing) {
          const tier = determineAcaTier(member);
          memberPlans.set(email.toLowerCase(), {
            email: email.toLowerCase(),
            skoolUserId: member.id,
            tier,
            status: 'cancelling',
            planDetails: { source: community.slug },
          });
        }
      }

      // Process churned members
      for (const member of churned) {
        const email = extractMemberEmail(member);
        if (!email) continue;

        const existing = memberPlans.get(email.toLowerCase());
        // Only mark as churned if not active in another community
        if (!existing || existing.status === 'churned') {
          memberPlans.set(email.toLowerCase(), {
            email: email.toLowerCase(),
            skoolUserId: member.id,
            tier: 'free',
            status: 'churned',
            planDetails: { source: community.slug },
          });
        }
      }

      // Delay between communities
      await new Promise(r => setTimeout(r, 2000));

      // Update last sync info for this community
      await supabase
        .from('skool_communities')
        .update({
          last_synced_at: new Date().toISOString(),
          last_sync_result: {
            active_count: active.length,
            churned_count: churned.length,
            cancelling_count: cancelling.length,
          },
        })
        .eq('id', community.id);

    } catch (error) {
      console.error(`❌ [Sync] Error processing ${community.slug}:`, error);
      result.errors++;

      // Log error to community record
      await supabase
        .from('skool_communities')
        .update({
          last_synced_at: new Date().toISOString(),
          last_sync_result: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        })
        .eq('id', community.id);
    }
  }

  console.log(`\n📊 [Sync] Collected ${memberPlans.size} unique members to sync`);

  // Now update ACA organizations based on collected data
  for (const [email, planInfo] of memberPlans) {
    try {
      // Find user by email
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, organization_id, email')
        .eq('email', email)
        .single();

      if (userError || !user) {
        // User not in ACA
        result.notFound++;
        continue;
      }

      if (!user.organization_id) {
        result.notFound++;
        continue;
      }

      // Get current organization plan
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('id, plan_tier, is_suspended, subscription_status, stripe_subscription_id')
        .eq('id', user.organization_id)
        .single();

      if (orgError || !org) {
        result.notFound++;
        continue;
      }

      const currentTier = org.plan_tier || 'free';
      const newTier = planInfo.tier;
      const isChurned = planInfo.status === 'churned';

      // Determine if update is needed
      let updateNeeded = false;
      const updates: any = {};

      if (currentTier !== newTier) {
        updates.plan_tier = newTier;
        updates.plan_changed_at = new Date().toISOString();
        updateNeeded = true;

        if (PLAN_TIER_PRIORITY.indexOf(newTier) > PLAN_TIER_PRIORITY.indexOf(currentTier as any)) {
          result.upgraded++;
          console.log(`⬆️ [Sync] Upgrading ${email}: ${currentTier} -> ${newTier}`);
        } else {
          result.downgraded++;
          console.log(`⬇️ [Sync] Downgrading ${email}: ${currentTier} -> ${newTier}`);
        }
      }

      // Skool grants access without a Stripe subscription. If this org has no
      // real stripe_subscription_id, its subscription_status is still whatever
      // provisioning set at signup ('trialing') and is never touched again by
      // this sync - so a Skool member on a paid tier keeps looking like an
      // unconverted, expired trial to the TrialBanner and onboarding-drip-tick's
      // "active" gate forever. Reconcile it here instead.
      if (!org.stripe_subscription_id) {
        if (!isChurned && newTier !== 'free' && org.subscription_status !== 'active') {
          updates.subscription_status = 'active';
          updates.trial_ends_at = null;
          updateNeeded = true;
        } else if (isChurned && org.subscription_status === 'active') {
          updates.subscription_status = 'canceled';
          updateNeeded = true;
        }
      }

      // Handle churned users - suspend if they were on a paid plan
      if (isChurned && !org.is_suspended && currentTier !== 'free') {
        updates.is_suspended = true;
        updates.suspended_at = new Date().toISOString();
        updates.suspension_reason = 'Skool membership churned';
        updateNeeded = true;
        result.churned++;
        console.log(`🚫 [Sync] Suspending churned user ${email}`);
      }

      // Unsuspend if they've reactivated
      if (!isChurned && org.is_suspended && planInfo.status === 'active') {
        updates.is_suspended = false;
        updates.suspended_at = null;
        updates.suspension_reason = null;
        updateNeeded = true;
        console.log(`✅ [Sync] Reactivating ${email}`);
      }

      if (updateNeeded) {
        const { error: updateError } = await supabase
          .from('organizations')
          .update(updates)
          .eq('id', org.id);

        if (updateError) {
          console.error(`❌ [Sync] Failed to update org for ${email}:`, updateError);
          result.errors++;
        } else {
          result.synced++;
        }
      } else {
        result.synced++;
      }

    } catch (error) {
      console.error(`❌ [Sync] Error processing ${email}:`, error);
      result.errors++;
    }
  }

  return result;
}

// ============================================================================
// Single User Check (for on-login verification)
// ============================================================================

async function checkSingleUser(
  supabase: any,
  skoolClient: SkoolClient,
  userEmail: string
): Promise<{ tier: 'free' | 'pro' | 'enterprise', status: string } | null> {

  // Fetch active communities from database
  const { data: communities, error: communitiesError } = await supabase
    .from('skool_communities')
    .select('*')
    .eq('is_active', true);

  if (communitiesError || !communities || communities.length === 0) {
    console.log('⚠️ [SingleCheck] No active Skool communities configured');
    return { tier: 'free', status: 'no_communities' };
  }

  let bestTier: 'free' | 'pro' | 'enterprise' = 'free';
  let memberStatus = 'not_found';

  for (const community of communities as SkoolCommunity[]) {
    try {
      const { active } = await skoolClient.getAllMembers(community.slug);

      const member = active.find(m => {
        const email = extractMemberEmail(m);
        return email?.toLowerCase() === userEmail.toLowerCase();
      });

      if (member) {
        const tier = determineAcaTier(member);
        if (PLAN_TIER_PRIORITY.indexOf(tier) > PLAN_TIER_PRIORITY.indexOf(bestTier)) {
          bestTier = tier;
        }
        memberStatus = 'active';
      }
    } catch (error) {
      console.error(`Error checking ${community.slug}:`, error);
    }
  }

  return { tier: bestTier, status: memberStatus };
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  const hostedOnly = hostedOnlyResponse("Skool sync", corsHeaders);
  if (hostedOnly) return hostedOnly;


  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const skoolEmail = Deno.env.get('SKOOL_EMAIL')!;
  const skoolPassword = Deno.env.get('SKOOL_PASSWORD')!;

  if (!skoolEmail || !skoolPassword) {
    return new Response(
      JSON.stringify({ error: 'Skool credentials not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Parse request body for single-user check
    let body: { user_email?: string, source?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    // The full sync (pg_cron job, admin panel) changes plan tiers for every Skool
    // member, so it needs the service-role key or a super-admin. A signed-in user
    // may only check their own email (the post-login check). The anon key is public.
    if (!isServiceRoleRequest(req)) {
      let callerId: string;
      try {
        callerId = (await authenticateRequest(req, supabase)).user_id;
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }
      const { data: caller } = await supabase
        .from('users')
        .select('email, is_super_admin')
        .eq('id', callerId)
        .maybeSingle();
      const ownEmail = (caller?.email ?? '').toLowerCase();
      const checkingSelf = !!body.user_email && body.user_email.toLowerCase() === ownEmail;
      if (!caller?.is_super_admin && !checkingSelf) {
        return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
      }
    }

    // Initialize Skool client and login
    const skoolClient = new SkoolClient(skoolEmail, skoolPassword);
    const loggedIn = await skoolClient.login();

    if (!loggedIn) {
      throw new Error('Failed to login to Skool');
    }

    // Single user check mode
    if (body.user_email) {
      console.log(`🔍 [Skool] Checking membership for: ${body.user_email}`);

      const result = await checkSingleUser(supabase, skoolClient, body.user_email);

      return new Response(
        JSON.stringify({ success: true, ...result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Full sync mode
    console.log('🔄 [Skool] Starting full membership sync...');

    const result = await syncMemberships(supabase, skoolClient);

    console.log('\n📊 [Skool] Sync completed:', result);

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ [Skool] Sync error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
