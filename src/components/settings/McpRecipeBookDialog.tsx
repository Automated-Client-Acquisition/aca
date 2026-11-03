import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, MessageSquare } from "lucide-react";

interface McpRecipeBookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Prompt({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 bg-muted/50 border rounded-lg p-3 my-2">
      <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <span className="text-sm">{children}</span>
    </div>
  );
}

function PromptList({ prompts }: { prompts: string[] }) {
  return (
    <div className="space-y-2 my-3">
      {prompts.map((prompt, i) => (
        <Prompt key={i}>{prompt}</Prompt>
      ))}
    </div>
  );
}

function Section({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div className="py-6 border-b last:border-b-0">
      <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
        <span>{emoji}</span> {title}
      </h2>
      {children}
    </div>
  );
}

function SubSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      {children}
    </div>
  );
}

export function McpRecipeBookDialog({ open, onOpenChange }: McpRecipeBookDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            MCP Recipe Book
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Your guide to managing content with Claude. Just tell Claude what you want in plain English.
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="pr-4">

            <Section emoji="🚀" title="Getting Started">
              <p className="text-sm text-muted-foreground">Once your MCP is connected, just talk to Claude naturally:</p>
              <PromptList prompts={[
                "Show me all the organizations I have access to",
                "What can you help me with?",
                "Give me the full documentation",
              ]} />
            </Section>

            <Section emoji="🏢" title="Working with Multiple Clients (For Agencies)">
              <SubSection title="See all your clients">
                <Prompt>List all the organizations I can access</Prompt>
              </SubSection>

              <SubSection title="Switch to a client's account" description="After switching, everything you do will be on that client's data.">
                <Prompt>Switch to [Client Name]'s organization</Prompt>
              </SubSection>

              <SubSection title="Switch back to your agency">
                <Prompt>Switch back to my agency account</Prompt>
              </SubSection>
            </Section>

            <Section emoji="📚" title="Building Your Content Library">
              <SubSection title="Brand Voices" description="Your brand's personality, tone, and style.">
                <PromptList prompts={[
                  "Show me all my brand voices",
                  "Create a brand voice called 'Friendly Expert' - professional but approachable, uses simple language",
                  "Update the [Name] brand voice to be more casual",
                ]} />
              </SubSection>

              <SubSection title="Products" description="Products or services you're creating content about.">
                <PromptList prompts={[
                  "List all my products",
                  "Create a product called 'My Product'. Key features: X, Y, Z. Main benefits: A, B, C",
                  "Show me everything about the [Product Name] product",
                ]} />
              </SubSection>

              <SubSection title="ICPs (Ideal Customer Profiles)" description="Your target audiences.">
                <PromptList prompts={[
                  "Show me all my ICPs",
                  "Create an ICP called 'Startup Founder'. Pain points: limited budget, no time. They want predictable leads.",
                  "Add a new pain point to the [ICP Name]: 'struggling to stand out'",
                ]} />
              </SubSection>

              <SubSection title="Characters" description="AI personas for video scripts and UGC content.">
                <PromptList prompts={[
                  "List all my characters",
                  "Create a character called 'Marketing Mike' - friendly, shares tips conversationally",
                ]} />
              </SubSection>

              <SubSection title="Content Blocks" description="Reusable snippets: hooks, angles, CTAs, story elements.">
                <PromptList prompts={[
                  "Show me all my hooks",
                  "Create a hook: I was skeptical too, until I tried this...",
                  "Create these CTAs: 'Save this for later', 'Follow for more tips'",
                ]} />
              </SubSection>
            </Section>

            <Section emoji="💡" title="Managing Ideas">
              <p className="text-sm text-muted-foreground mb-4">Ideas are content topics you save for later development.</p>

              <SubSection title="Tags First">
                <PromptList prompts={[
                  "Create a tag called 'Q1 Campaign'",
                  "Create tags for: Product Launch, Evergreen, Case Studies",
                  "List all my tags",
                ]} />
              </SubSection>

              <SubSection title="Working with Ideas">
                <PromptList prompts={[
                  "Show me all my ideas",
                  "Show me ideas about productivity",
                  "Save an idea: '10 Productivity Hacks' with keywords remote work, tips. Tag it as Evergreen.",
                  "Create these content ideas: 'Why Marketing Fails' - tag as Evergreen, 'How X Grew 300%' - tag as Case Studies",
                  "Assign the tags 'Q1' and 'Launch' to the idea '[Title]'",
                ]} />
              </SubSection>
            </Section>

            <Section emoji="📋" title="Strategy Documents">
              <p className="text-sm text-muted-foreground mb-4">Store your marketing strategies, lead magnets, funnels, email sequences, and more.</p>
              <PromptList prompts={[
                "List all my strategy documents",
                "Show me just my lead magnet documents",
                "Create a strategy document called 'Q1 Strategy'. Type: content calendar. Content: [paste your plan]",
                "Show me the full content of '[Document Name]'",
              ]} />
            </Section>

            <Section emoji="🎨" title="Blueprints">
              <p className="text-sm text-muted-foreground mb-4">Templates that control how your content gets generated.</p>
              <PromptList prompts={[
                "List all my blueprints",
                "Show me the full details of '[Blueprint]' including the prompts",
                "Create a blueprint called 'LinkedIn Post'. It should create story-driven posts with a hook and takeaway.",
              ]} />
            </Section>

            <Section emoji="⚡" title="Generating Content">
              <SubSection title="Reference Info">
                <PromptList prompts={[
                  "What pipelines/content types are available?",
                  "What AI models are available?",
                  "What voices are available for video?",
                ]} />
              </SubSection>

              <SubSection title="Generate Content">
                <PromptList prompts={[
                  "Generate content using '[Blueprint]' for my idea '[Title]'",
                  "Generate a social post using Blueprint: X, Brand voice: Y, Product: Z, Target ICP: W",
                  "Generate posts for '[Idea]' - create a separate version for each ICP: Founder, Manager, Executive",
                  "Generate content for all my ideas tagged 'Q1' using blueprint '[Name]' - auto-approve everything",
                ]} />
              </SubSection>

              <SubSection title="Quick Carousels" description="Create Instagram carousels from a short topic without a full blueprint.">
                <PromptList prompts={[
                  "Create a carousel about '5 tips for better sleep'",
                  "Create a carousel about 'AI agents' using my brand voice [Name], 7 slides, midnight template",
                ]} />
              </SubSection>

              <SubSection title="Check Jobs">
                <PromptList prompts={[
                  "Show me my content generation jobs",
                  "Show me jobs that are still processing",
                  "Show me the results of generation job [job ID]",
                ]} />
              </SubSection>
            </Section>

            <Section emoji="🤖" title="Content Autopilots">
              <p className="text-sm text-muted-foreground mb-4">Autopilots automatically generate and publish content on a schedule.</p>

              <SubSection title="View & Create">
                <PromptList prompts={[
                  "List all my content autopilots",
                  "Show me the details of autopilot '[Name]'",
                  "Show me my publishing accounts",
                  "Create an autopilot called 'Daily Posts': use blueprint [Name] at 100% weight, generate once per day, publish to my Instagram account, use ideas tagged 'tips'",
                ]} />
              </SubSection>

              <SubSection title="Control & Pool Management">
                <PromptList prompts={[
                  "Trigger my '[Name]' autopilot now",
                  "Pause the autopilot '[Name]'",
                  "Show me the idea pool for autopilot '[Name]'",
                  "Sync the idea pool for '[Name]' from its tags",
                  "Recycle used ideas back to available in '[Name]'",
                ]} />
              </SubSection>
            </Section>

            <Section emoji="📤" title="Publishing to Social Media">
              <p className="text-sm text-muted-foreground mb-4">Push generated content to connected social media accounts via GHL/LeadConnector.</p>
              <PromptList prompts={[
                "List my connected social media accounts",
                "Publish the output from my latest generation job to my Instagram and Facebook",
                "Schedule this output to publish on March 1st at 10am to my LinkedIn account",
              ]} />
            </Section>

            <Section emoji="🧠" title="AI Agent Profiles">
              <p className="text-sm text-muted-foreground mb-4">Define how the AI autopilot behaves in conversations - intents, actions, escalation rules.</p>
              <PromptList prompts={[
                "List all my AI agent profiles",
                "Show me the details of '[Profile Name]'",
                "Create an agent profile called 'SDR Follow-up': goal is to book a demo call, auto-reply to interested leads, escalate on hostile sentiment, use knowledge base",
                "Set '[Profile Name]' as the default agent profile",
              ]} />
            </Section>

            <Section emoji="📖" title="Knowledge Base">
              <p className="text-sm text-muted-foreground mb-4">Upload documents for AI agents to reference during conversations (RAG).</p>
              <PromptList prompts={[
                "List all my knowledge base documents",
                "Create a knowledge base document called 'Product FAQ' with this content: [paste FAQ]",
                "Show me the details of knowledge document '[Name]'",
                "Delete the knowledge document '[Name]'",
              ]} />
            </Section>

            <Section emoji="👥" title="CRM Contacts">
              <p className="text-sm text-muted-foreground mb-4">Manage prospects, leads, and customers in your CRM.</p>

              <SubSection title="View & Search">
                <PromptList prompts={[
                  "List all my CRM contacts",
                  "Search contacts for 'John'",
                  "Show me contacts tagged as 'VIP'",
                  "Show me all my CRM pipelines and stages",
                ]} />
              </SubSection>

              <SubSection title="Create & Update">
                <PromptList prompts={[
                  "Create a contact: John Smith, CEO at Acme Corp, john@acme.com",
                  "Update John Smith - change his job title to 'CTO' and add tag 'Enterprise'",
                  "Add a note to John Smith: 'Had a great call, interested in Pro plan'",
                ]} />
              </SubSection>

              <SubSection title="Bulk Operations">
                <PromptList prompts={[
                  "Update all contacts tagged 'cold-leads' to status 'archived'",
                  "Search for 'John Smith' across both CRM contacts and email leads",
                ]} />
              </SubSection>
            </Section>

            <Section emoji="📧" title="Email Leads & Sequences">
              <SubSection title="Email Leads" description="Contacts specifically used in email sequences.">
                <PromptList prompts={[
                  "Show me all my email leads",
                  "Create an email lead: john@acme.com, John Smith, CEO at Acme Corp",
                  "Create these leads in bulk: john@acme.com, jane@startup.io, bob@agency.com",
                  "List all my connected email mailboxes",
                ]} />
              </SubSection>

              <SubSection title="Email Sequences" description="Automated email sequences for outreach.">
                <PromptList prompts={[
                  "List all my email sequences",
                  "Create a sequence called 'Cold Outreach v1' with 3 emails and delays between them",
                  "Activate the email sequence '[Name]'",
                  "Enroll these leads into sequence '[Name]': [list of leads]",
                  "Show me enrollments with status 'replied' in sequence '[Name]'",
                ]} />
              </SubSection>
            </Section>

            <Section emoji="📋" title="Lead Lists">
              <p className="text-sm text-muted-foreground mb-4">Organize contacts into lists for campaigns and outreach.</p>
              <PromptList prompts={[
                "List all my lead lists",
                "Create a lead list called 'Q1 Outreach Targets'",
                "Show me the members of list '[Name]'",
                "Add contacts John Smith and Jane Doe to the '[Name]' list",
                "Remove John Smith from the '[Name]' list",
              ]} />
            </Section>

            <Section emoji="🔗" title="LinkedIn Network & Import">
              <SubSection title="Connections">
                <PromptList prompts={[
                  "List my LinkedIn connections",
                  "Search my LinkedIn connections for 'Marketing Director'",
                ]} />
              </SubSection>

              <SubSection title="Lead Import" description="Import leads from LinkedIn search results into lead lists.">
                <PromptList prompts={[
                  "Search LinkedIn for the location ID for 'San Francisco'",
                  "Look up the LinkedIn industry ID for 'Software Development'",
                  "Build a LinkedIn search URL for 'CEO' in San Francisco, Software industry",
                  "Import 200 leads from LinkedIn search for 'VP Sales' in New York into list 'VP Sales NYC'",
                  "How's my LinkedIn import job doing?",
                ]} />
              </SubSection>
            </Section>

            <Section emoji="🎯" title="Lead Magnet Campaigns">
              <p className="text-sm text-muted-foreground mb-4">Monitor LinkedIn/Instagram posts for keyword comments and auto-send DMs.</p>
              <PromptList prompts={[
                "List all my lead magnet campaigns",
                "Create a campaign called 'AI Guide Giveaway': monitor for keywords 'guide, send, want', DM: 'Hey! Here's the link...'",
                "Create a campaign with AI chatbot enabled - qualify leads and send calendly when interested",
                "Show me leads captured by campaign '[Name]'",
                "Activate the lead magnet campaign '[Name]'",
              ]} />
            </Section>

            <Section emoji="📡" title="Outreach Campaigns">
              <p className="text-sm text-muted-foreground mb-4">Multi-channel outreach sequences: LinkedIn, email, WhatsApp, Instagram, and more.</p>

              <SubSection title="View & Create">
                <PromptList prompts={[
                  "Show me available sender accounts",
                  "List all my outreach campaigns",
                  "Show me the full details of campaign '[Name]' including the sequence",
                ]} />
              </SubSection>

              <SubSection title="Create a Campaign">
                <PromptList prompts={[
                  "Create a LinkedIn campaign 'Q1 Outreach': lead list [Name], connection request then message if connected",
                  "Create a multi-channel campaign: LinkedIn profile view, then connection request, if not connected switch to email",
                ]} />
              </SubSection>

              <SubSection title="Control">
                <PromptList prompts={[
                  "Activate campaign '[Name]'",
                  "Pause campaign '[Name]'",
                  "Delete campaign '[Name]'",
                ]} />
              </SubSection>
            </Section>

            <Section emoji="📝" title="Common Workflows">
              <SubSection title="Setting Up a New Client">
                <div className="bg-muted/30 border rounded-lg p-4 my-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">1.</span> Switch to [Client]'s organization</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">2.</span> Create a brand voice called [Name]...</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">3.</span> Create a product called [Name]...</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">4.</span> Create an ICP called [Name]...</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">5.</span> Create these tags: [list]</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">6.</span> Upload knowledge base docs for AI context</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">7.</span> Create an AI agent profile for their team</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">8.</span> Switch back to my agency</div>
                </div>
              </SubSection>

              <SubSection title="Building a Content Calendar">
                <div className="bg-muted/30 border rounded-lg p-4 my-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">1.</span> Create a strategy document for our Q1 calendar: [paste plan]</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">2.</span> Create tags for: Q1, Launch, Evergreen, Educational</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">3.</span> Create these content ideas from our calendar: [list ideas with tags]</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">4.</span> Create an autopilot to generate and publish daily from those ideas</div>
                </div>
              </SubSection>

              <SubSection title="Full Outreach Pipeline">
                <div className="bg-muted/30 border rounded-lg p-4 my-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">1.</span> Search LinkedIn for 'VP Marketing' in San Francisco, Software industry</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">2.</span> Import 200 leads into a list called 'VP Marketing SF'</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">3.</span> Create an email sequence with 3 follow-up emails</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">4.</span> Create leads from the contacts and enroll them</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">5.</span> Activate the sequence</div>
                </div>
              </SubSection>

              <SubSection title="Multi-Channel Campaign">
                <div className="bg-muted/30 border rounded-lg p-4 my-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">1.</span> Create a lead list and import leads from LinkedIn</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">2.</span> Create a multi-channel campaign: LinkedIn view, connect, then message or switch to email</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">3.</span> Activate the campaign</div>
                </div>
              </SubSection>

              <SubSection title="AI-Powered Inbound Lead Capture">
                <div className="bg-muted/30 border rounded-lg p-4 my-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">1.</span> Create a knowledge base document with your product FAQ</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">2.</span> Create an AI agent profile with booking goal</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">3.</span> Create a lead magnet campaign with AI chatbot + ICP filtering</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">4.</span> Activate the campaign</div>
                </div>
              </SubSection>

              <SubSection title="Creating Personalized Content" description="This creates 3 different posts, each tailored to a specific audience!">
                <div className="bg-muted/30 border rounded-lg p-4 my-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">1.</span> Show me all my ICPs</div>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">2.</span> Generate a LinkedIn post about [topic] - create a separate version for each ICP: [list 3 ICPs]</div>
                </div>
              </SubSection>
            </Section>

            <Section emoji="💡" title="Tips">
              <div className="space-y-3">
                <div className="flex gap-3">
                  <span className="text-muted-foreground shrink-0">1.</span>
                  <div><strong>Always know where you are</strong> <span className="text-muted-foreground">– Ask "which organization am I working in?" if unsure</span></div>
                </div>
                <div className="flex gap-3">
                  <span className="text-muted-foreground shrink-0">2.</span>
                  <div><strong>Create in bulk</strong> <span className="text-muted-foreground">– Give Claude a list of 10-20 ideas at once</span></div>
                </div>
                <div className="flex gap-3">
                  <span className="text-muted-foreground shrink-0">3.</span>
                  <div><strong>Tag strategically</strong> <span className="text-muted-foreground">– Set up your tag system before creating lots of ideas</span></div>
                </div>
                <div className="flex gap-3">
                  <span className="text-muted-foreground shrink-0">4.</span>
                  <div><strong>Use "separate" for personalization</strong> <span className="text-muted-foreground">– Ask for "separate versions" to get content for each ICP</span></div>
                </div>
                <div className="flex gap-3">
                  <span className="text-muted-foreground shrink-0">5.</span>
                  <div><strong>Start with strategy</strong> <span className="text-muted-foreground">– Create your strategy document first, then pull ideas from it</span></div>
                </div>
                <div className="flex gap-3">
                  <span className="text-muted-foreground shrink-0">6.</span>
                  <div><strong>Auto-approve for bulk</strong> <span className="text-muted-foreground">– Use auto-approve when generating lots of content to skip manual review</span></div>
                </div>
                <div className="flex gap-3">
                  <span className="text-muted-foreground shrink-0">7.</span>
                  <div><strong>Use the help system</strong> <span className="text-muted-foreground">– Ask "get help on campaigns" or "get help on autopilots" for detailed docs</span></div>
                </div>
                <div className="flex gap-3">
                  <span className="text-muted-foreground shrink-0">8.</span>
                  <div><strong>LinkedIn import workflow</strong> <span className="text-muted-foreground">– Search for parameter IDs first (location, industry), then import</span></div>
                </div>
              </div>
            </Section>

            <Section emoji="?" title="Need Help?">
              <p className="text-sm text-muted-foreground mb-3">Just ask Claude:</p>
              <PromptList prompts={[
                "What can you help me with?",
                "Give me the full documentation",
                "Get help on [topic] (overview, ideas, library, content_generation, blueprints, organizations, campaigns, autopilots)",
                "How do I [specific task]?",
              ]} />
              <p className="text-center text-muted-foreground mt-6 italic text-sm">
                Claude is here to help – just describe what you want in plain English!
              </p>
            </Section>

          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
