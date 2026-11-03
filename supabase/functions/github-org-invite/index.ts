// Public endpoint behind /access-cedric-github: invites a GitHub user to the
// Automated-Client-Acquisition org. The page link is only shared inside the
// private community, so anyone who reaches it is granted access.
//
// Secrets: GITHUB_ORG_INVITE_TOKEN (org owner token, "Members: read & write"
// fine-grained or classic admin:org). Optional GITHUB_ORG (defaults below).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ORG = Deno.env.get("GITHUB_ORG") || "Automated-Client-Acquisition";
const INVITATION_URL = `https://github.com/orgs/${ORG}/invitation`;

// GitHub usernames: alphanumeric or single hyphens, no leading/trailing hyphen, max 39.
const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Accepts "octocat", "@octocat" or "https://github.com/octocat".
function parseUsername(raw: unknown): string {
  let value = (typeof raw === "string" ? raw : "").trim();
  value = value.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^@/, "");
  return value.split(/[/?#]/)[0];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const token = Deno.env.get("GITHUB_ORG_INVITE_TOKEN");
  if (!token) {
    console.error("GITHUB_ORG_INVITE_TOKEN is not set");
    return json({ error: "Invites are not configured yet. Ping Cedric." }, 500);
  }

  let body: { username?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  const username = parseUsername(body.username);
  if (!USERNAME_RE.test(username)) {
    return json({ error: "That doesn't look like a GitHub username." }, 400);
  }

  const gh = (path: string, init: RequestInit = {}) =>
    fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "aca-github-org-invite",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });

  try {
    const userRes = await gh(`/users/${encodeURIComponent(username)}`);
    if (userRes.status === 404) {
      return json({ error: `No GitHub account called "${username}".` }, 404);
    }
    if (!userRes.ok) {
      console.error("GitHub user lookup failed", userRes.status, await userRes.text());
      return json({ error: "Couldn't reach GitHub. Try again in a minute." }, 502);
    }
    const user = await userRes.json();

    // 204 = already a member (visible to org owners regardless of visibility)
    const memberRes = await gh(`/orgs/${ORG}/members/${encodeURIComponent(user.login)}`);
    if (memberRes.status === 204) {
      return json({ status: "already_member", login: user.login, org_url: `https://github.com/${ORG}` });
    }

    const inviteRes = await gh(`/orgs/${ORG}/invitations`, {
      method: "POST",
      body: JSON.stringify({ invitee_id: user.id, role: "direct_member" }),
    });

    if (inviteRes.ok) {
      console.log(`Invited ${user.login} (${user.id}) to ${ORG}`);
      return json({ status: "invited", login: user.login, invitation_url: INVITATION_URL });
    }

    const errText = await inviteRes.text();
    // 422 when an invitation is already pending for this user
    if (inviteRes.status === 422 && /already/i.test(errText)) {
      return json({ status: "already_invited", login: user.login, invitation_url: INVITATION_URL });
    }

    console.error("GitHub invite failed", inviteRes.status, errText);
    return json({ error: "GitHub refused the invite. Ping Cedric and he'll add you." }, 502);
  } catch (err) {
    console.error("github-org-invite error", err);
    return json({ error: "Something went wrong. Try again in a minute." }, 500);
  }
});
