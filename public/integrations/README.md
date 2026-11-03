# Homepage integration assets

`highlevel.svg` is the unmodified official HighLevel wordmark downloaded on
2026-10-11 from the logo displayed on https://www.gohighlevel.com/:

https://assets.cdn.filesafe.space/knES3eSWYIsc5YSZ3YLl/media/6a3d48e8e4daecfbb47f2a0b.svg

It has white lettering and should be displayed on a dark background. It is served
locally so homepage visitors do not send logo requests to another service.

Other marks are reused from the project's existing `public/logos/*.svg` assets
and the existing Gmail / Outlook SVG marks in `BrandIcons.tsx`. These are brand
marks, not generic illustrations or recreated text logos.

Integration evidence in the application:

- LinkedIn, Instagram, WhatsApp, Telegram: `_shared/channels/unipile.ts` adapters.
- Gmail / Outlook: email mailbox provider support and Unipile email routing.
- HighLevel: `useGHLAccounts.ts`, `usePushContactToGHL.ts`.
- Notion: `useEmailSequenceJobs.ts`, `useNotionCustomTemplates.ts`.
- OpenRouter / Replicate / ElevenLabs: registered adapters under
  `supabase/functions/_shared/providers/`.

These labels describe product connectivity, not endorsements or partnerships.

2026-10-12 expanded catalogue:

- Additional authentic vendor marks and exact source URLs: `vendor-sources.md`.
- Ollama, Alibaba Cloud, YouTube, Pexels, Porkbun, Google and Backblaze marks:
  installed `react-icons/si` Simple Icons collection.
- `highlevel-on-light.svg`: same official geometry/colors; white lettering rendered
  in dark ink for a light surface. `zapmail-on-light.svg` and
  `unipile-on-light.svg` apply the same treatment to white wordmark lettering,
  retaining the original colored symbol paths. `instantly-on-light.svg` renders
  the existing white mark in its brand blue. No new logo geometry is drawn.
- Current connections are sourced from `IntegrationsTab`, `AddApiKeyDialog`,
  `SendersSettings`, `EmailToolConnections`, `DnsProvidersSettings`, and
  `StorageSettings`. Public descriptions name available connection capabilities,
  not configured status, provider uptime, or an endorsement.
- Google Indexing API is shown as an indexing connection; Facebook/TikTok are
  destinations through HighLevel, not separately advertised native connections.
- `openrouter-on-light.svg` uses a darker monochrome foreground for the existing
  mark. Microsoft 365 is sourced from tenant infrastructure setup and mailbox
  provisioning (`ConnectTenantWizard`, `useM365Mailboxes`); Outlook here means
  the separate Unipile account connection, not the upcoming direct mailbox OAuth.

2026-10-12 symbol normalization: homepage featured and full lists use identical
symbol slots and name typography. Wide vendor artwork is isolated with an SVG
image viewport in `IntegrationBrands.tsx`; original vendor geometry and PNGs
are preserved. The light ZapMail variant renders both white fills and white
outline strokes in dark ink. Default product-preview brand rendering is unchanged.
