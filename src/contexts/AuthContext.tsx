import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { UserRole, OrganizationContext, getOrgInitials, getOrgColor } from "@/types/organization";

// Extended user data from users table
interface ExtendedUserData {
  id: string;
  email: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  organization_id: string;
  active_organization_id: string | null;
  can_access_organizations: string[] | null;
  is_super_admin: boolean;
  impersonating_organization_id: string | null;
}

// Helper to get display name from user data
export function getDisplayName(user: ExtendedUserData | null): string {
  if (!user) return "";
  if (user.first_name && user.last_name) {
    return `${user.first_name} ${user.last_name}`;
  }
  if (user.first_name) return user.first_name;
  if (user.full_name) return user.full_name;
  return user.email.split("@")[0];
}

// Helper to get user initials
export function getUserInitials(user: ExtendedUserData | null): string {
  if (!user) return "??";
  if (user.first_name && user.last_name) {
    return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
  }
  if (user.first_name) {
    return user.first_name.slice(0, 2).toUpperCase();
  }
  if (user.full_name) {
    const parts = user.full_name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return user.full_name.slice(0, 2).toUpperCase();
  }
  return user.email.slice(0, 2).toUpperCase();
}

// Organization with basic info
interface Organization {
  id: string;
  name: string;
  slug: string;
  type: string;
  parent_id: string | null;
  status: string | null;
  plan_tier: string | null;
  limits: Record<string, unknown> | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  // Extended organization context
  extendedUser: ExtendedUserData | null;
  currentOrganization: Organization | null;
  userRole: UserRole | null;
  isAgency: boolean;
  isClient: boolean;
  isSuperAdmin: boolean;
  isImpersonating: boolean;
  // Methods
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string, redirectPath?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<{ error: Error | null }>;
  startImpersonation: (orgId: string) => Promise<{ error: Error | null }>;
  endImpersonation: () => Promise<{ error: Error | null }>;
  refreshOrganizationContext: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Extended state
  const [extendedUser, setExtendedUser] = useState<ExtendedUserData | null>(null);
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [isAgency, setIsAgency] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Track if we've already fetched org context to prevent duplicate fetches
  const orgContextFetchedRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const fetchPromiseRef = useRef<Promise<boolean> | null>(null);

  // Derived state
  const isSuperAdmin = extendedUser?.is_super_admin ?? false;
  const isImpersonating = !!extendedUser?.impersonating_organization_id;

  // Fetch extended user data and organization context
  // Returns true if fetching was skipped (already done), false otherwise
  const fetchOrganizationContext = useCallback(async (userId: string, _retryCount = 0, force = false): Promise<boolean> => {
    // Skip if already fetched for this user (unless forced)
    if (!force && orgContextFetchedRef.current === userId) {
      return true; // skipped
    }

    // If already fetching, wait for the existing promise instead of starting a new fetch
    if (isFetchingRef.current && fetchPromiseRef.current && !force) {
      return fetchPromiseRef.current;
    }

    const MAX_RETRIES = 5;
    const RETRY_DELAY = 1500; // ms - increased for cold start scenarios

    // Create the actual fetch logic with built-in retry loop
    const doFetch = async (): Promise<boolean> => {
      let attempts = 0;

      while (attempts <= MAX_RETRIES) {
        attempts++;
        try {

          const { data: userData, error: userError } = await supabase
            .from("users")
            .select("*")
            .eq("id", userId)
            .single();

          if (userError || !userData) {
            // For new signups, the database trigger may not have completed yet
            if (attempts <= MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
              continue; // retry
            }
            console.error("[AuthContext] Error fetching user data after retries:", userError);
            orgContextFetchedRef.current = userId;
            return false;
          }

          // Cast userData to include new fields (first_name, last_name) added via migration
          const userDataWithNewFields = userData as typeof userData & {
            first_name?: string | null;
            last_name?: string | null;
          };

          setExtendedUser({
            id: userDataWithNewFields.id,
            email: userDataWithNewFields.email,
            full_name: userDataWithNewFields.full_name,
            first_name: userDataWithNewFields.first_name ?? null,
            last_name: userDataWithNewFields.last_name ?? null,
            avatar_url: userDataWithNewFields.avatar_url,
            organization_id: userDataWithNewFields.organization_id,
            active_organization_id: userDataWithNewFields.active_organization_id,
            can_access_organizations: userDataWithNewFields.can_access_organizations,
            is_super_admin: userDataWithNewFields.is_super_admin ?? false,
            impersonating_organization_id: userDataWithNewFields.impersonating_organization_id,
          });

          // Determine effective organization ID (impersonating > active > default)
          const effectiveOrgId =
            userData.impersonating_organization_id ||
            userData.active_organization_id ||
            userData.organization_id;

          // Fetch organization data
          const { data: orgData, error: orgError } = await supabase
            .from("organizations")
            .select("id, name, slug, type, parent_id, status, plan_tier, limits, subscription_status, trial_ends_at, stripe_customer_id, stripe_subscription_id, past_due_since")
            .eq("id", effectiveOrgId)
            .single();

          if (orgError || !orgData) {
            console.error("Error fetching organization:", orgError);
            orgContextFetchedRef.current = userId;
            return false;
          }

          setCurrentOrganization(orgData as Organization);

          // Determine if this org is an agency (has child orgs)
          const { count: childCount } = await supabase
            .from("organizations")
            .select("id", { count: "exact" })
            .eq("parent_id", effectiveOrgId)
            .limit(0);

          setIsAgency((childCount ?? 0) > 0);
          setIsClient(!!orgData.parent_id);

          // Fetch user's role in this organization
          if (userData.is_super_admin) {
            setUserRole("super_admin");
          } else {
            const { data: memberData } = await supabase
              .from("organization_members")
              .select("role")
              .eq("user_id", userId)
              .eq("organization_id", effectiveOrgId)
              .single();

            setUserRole((memberData?.role as UserRole) || "member");
          }

          // Mark as successfully fetched
          orgContextFetchedRef.current = userId;
          return false; // completed successfully
        } catch (error) {
          console.error("Error in fetchOrganizationContext attempt", attempts, ":", error);
          if (attempts <= MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            continue; // retry
          }
          orgContextFetchedRef.current = userId;
          return false;
        }
      }

      // Should not reach here, but just in case
      orgContextFetchedRef.current = userId;
      return false;
    };

    // Set flags and store promise before starting
    isFetchingRef.current = true;

    const promise = doFetch().finally(() => {
      isFetchingRef.current = false;
      fetchPromiseRef.current = null;
    });

    fetchPromiseRef.current = promise;
    return promise;
  }, []);

  // Subscribe to organization changes (for plan_tier updates)
  useEffect(() => {
    if (!currentOrganization?.id) return;

    const channel = supabase
      .channel(`org-${currentOrganization.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'organizations',
          filter: `id=eq.${currentOrganization.id}`,
        },
        (payload) => {
          const newData = payload.new as {
            id: string;
            name: string;
            slug: string;
            type: string;
            parent_id: string | null;
            status: string | null;
            plan_tier: string | null;
            limits: Record<string, unknown> | null;
          };

          // Update organization in state
          setCurrentOrganization({
            id: newData.id,
            name: newData.name,
            slug: newData.slug,
            type: newData.type,
            parent_id: newData.parent_id,
            status: newData.status,
            plan_tier: newData.plan_tier,
            limits: newData.limits,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentOrganization?.id]);

  useEffect(() => {
    let isSubscribed = true;

    // Set up auth state listener
    // IMPORTANT: Don't use async/await inside onAuthStateChange callback
    // as it can block Supabase's internal state management
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isSubscribed) return;

        // Synchronously update auth state first
        setSession(session);
        setUser(session?.user ?? null);

        if (!session?.user) {
          // Clear extended state on logout
          setExtendedUser(null);
          setCurrentOrganization(null);
          setUserRole(null);
          setIsAgency(false);
          setIsClient(false);
          orgContextFetchedRef.current = null;
          setLoading(false);
        } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          // Fetch org context asynchronously - don't block the callback
          fetchOrganizationContext(session.user.id)
            .catch((err) => {
              console.error('[AuthContext] fetchOrganizationContext error:', err);
            })
            .finally(() => {
              if (isSubscribed) {
                setLoading(false);
              }
            });
        } else if (event === 'TOKEN_REFRESHED') {
          // Token refresh doesn't need org context refetch
          setLoading(false);
        }
      }
    );

    // Get initial session
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!isSubscribed) return;

        // Set initial state - onAuthStateChange will handle the rest
        if (!session) {
          setLoading(false);
        }
        // If there's a session, onAuthStateChange INITIAL_SESSION will handle it
      })
      .catch((error) => {
        console.error('[AuthContext] getSession error:', error);
        if (isSubscribed) {
          setLoading(false);
        }
      });

    return () => {
      isSubscribed = false;
      subscription.unsubscribe();
    };
  }, [fetchOrganizationContext]);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      // On successful login, trigger a Skool membership check in the background
      // This ensures users get instant access if they've upgraded their Skool plan
      if (!error) {
        supabase.functions.invoke('sync-skool-memberships', {
          body: { user_email: email },
        }).then(({ error: skoolError }) => {
          if (skoolError) {
            console.warn('[AuthContext] Skool check failed:', skoolError);
          }
        }).catch((err) => {
          console.warn('[AuthContext] Skool check error:', err);
        });
      }

      return { error };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signUp = async (email: string, password: string, fullName?: string, redirectPath?: string) => {
    try {
      // redirectPath is pre-validated by safeNextPath; the confirmation email
      // then resumes the flow the user started (e.g. an MCP connection).
      const redirectUrl = `${window.location.origin}${redirectPath ?? "/"}`;
      
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName,
          },
        },
      });
      return { error };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    // Clear impersonation on logout
    if (isImpersonating && user) {
      try {
        await supabase
          .from("users")
          .update({ impersonating_organization_id: null })
          .eq("id", user.id);
      } catch (e) {
        // Ignore errors if session is already invalid
        console.warn('[AuthContext] Could not clear impersonation during logout:', e);
      }
    }

    try {
      await supabase.auth.signOut();
    } catch (error) {
      // If signOut fails (e.g., session already invalidated),
      // clear local state anyway to ensure the user is logged out locally
      console.warn('[AuthContext] signOut error (session may be stale):', error);
    }

    // Always clear local state regardless of server response
    // This handles the case where the session was already invalidated server-side
    setSession(null);
    setUser(null);
    setExtendedUser(null);
    setCurrentOrganization(null);
    setUserRole(null);
    setIsAgency(false);
    setIsClient(false);
    orgContextFetchedRef.current = null;
  };

  // Switch to a different organization
  const switchOrganization = async (orgId: string): Promise<{ error: Error | null }> => {
    if (!user) {
      return { error: new Error("No user logged in") };
    }

    try {
      // Verify user has access to this organization
      const { data: accessCheck } = await supabase
        .from("organization_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("organization_id", orgId)
        .single();

      // Also check can_access_organizations array
      const canAccess =
        accessCheck ||
        extendedUser?.can_access_organizations?.includes(orgId) ||
        isSuperAdmin;

      if (!canAccess) {
        return { error: new Error("You do not have access to this organization") };
      }

      // Update active organization
      const { error } = await supabase
        .from("users")
        .update({ active_organization_id: orgId })
        .eq("id", user.id);

      if (error) {
        return { error };
      }

      // Refresh context (force)
      await fetchOrganizationContext(user.id, 0, true);
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  // Start impersonating an organization (super admin only)
  const startImpersonation = async (orgId: string): Promise<{ error: Error | null }> => {
    if (!user) {
      return { error: new Error("Please sign in to continue") };
    }
    if (!isSuperAdmin) {
      return { error: new Error("You don't have permission to view as this client. Please contact your administrator.") };
    }

    try {
      // Get target org name and status for validation and audit log
      const { data: targetOrg, error: orgError } = await supabase
        .from("organizations")
        .select("name, status")
        .eq("id", orgId)
        .single();

      if (orgError) {
        return { error: new Error("Organization not found") };
      }

      // Check if target org is archived
      if (targetOrg.status === "archived") {
        return { error: new Error("Cannot impersonate an archived organization. Reactivate it first.") };
      }

      // Log impersonation start
      await supabase.from("impersonation_logs").insert({
        super_admin_id: user.id,
        target_organization_id: orgId,
        target_organization_name: targetOrg?.name || "Unknown",
        action: "start",
      });

      // Set impersonation
      const { error } = await supabase
        .from("users")
        .update({ impersonating_organization_id: orgId })
        .eq("id", user.id);

      if (error) {
        return { error };
      }

      // Refresh context (force)
      await fetchOrganizationContext(user.id, 0, true);
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  // End impersonation (super admin only)
  const endImpersonation = async (): Promise<{ error: Error | null }> => {
    if (!user) {
      return { error: new Error("No user logged in") };
    }

    try {
      // Log impersonation end
      if (extendedUser?.impersonating_organization_id) {
        // Update the most recent impersonation log
        const { data: recentLog } = await supabase
          .from("impersonation_logs")
          .select("id")
          .eq("super_admin_id", user.id)
          .eq("target_organization_id", extendedUser.impersonating_organization_id)
          .eq("action", "start")
          .is("ended_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (recentLog) {
          await supabase
            .from("impersonation_logs")
            .update({ ended_at: new Date().toISOString() })
            .eq("id", recentLog.id);
        }

        // Also insert an 'end' action
        await supabase.from("impersonation_logs").insert({
          super_admin_id: user.id,
          target_organization_id: extendedUser.impersonating_organization_id,
          action: "end",
        });
      }

      // Clear impersonation
      const { error } = await supabase
        .from("users")
        .update({ impersonating_organization_id: null })
        .eq("id", user.id);

      if (error) {
        return { error };
      }

      // Refresh context (force)
      await fetchOrganizationContext(user.id, 0, true);
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  // Manual refresh of organization context
  const refreshOrganizationContext = async () => {
    if (user) {
      await fetchOrganizationContext(user.id, 0, true); // force=true
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        extendedUser,
        currentOrganization,
        userRole,
        isAgency,
        isClient,
        isSuperAdmin,
        isImpersonating,
        signIn,
        signUp,
        signOut,
        switchOrganization,
        startImpersonation,
        endImpersonation,
        refreshOrganizationContext,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
