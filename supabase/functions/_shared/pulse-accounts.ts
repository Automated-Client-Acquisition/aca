/**
 * Default X accounts Signals follows, and what counts as a launch post.
 *
 *   OFFICIAL  labs, products and tools. A launch-worded post from one of these is a
 *             story on its own ("Introducing Claude Opus 5.5").
 *   INSIDERS  people and news accounts who break or amplify news. A story is a new
 *             name that several of them pick up within a few hours.
 *
 * Backtested 17-24 Sep 2026 (134 accounts, 2,216 posts): official launches surfaced
 * the moment they were posted; 4+ insiders caught Opus 5.5, GPT-6 Sol, Grok 4.7 and
 * Gemini 3.8 within 5-60 minutes. Tools that returned no posts in two weeks (Clay,
 * Apollo, Smartlead, HeyReach, lemlist, Gong) were left out.
 *
 * Handles re-checked against X profiles 28 Sep 2026: a search for a handle that no
 * longer exists just returns nothing, so a rename looks like a quiet account.
 * Renamed: elevenlabsio → ElevenLabs, OpenRouterAI → OpenRouter, lovable_dev → Lovable,
 * LangChainAI → LangChain, HeyGen_Official → HeyGen, rileybrown_ai → rileybrown,
 * Teknium1 → Teknium. Dropped: NotebookLM and slow_developer (not found),
 * benedictevans (no posts on X).
 */

export const DEFAULT_OFFICIAL_ACCOUNTS = [
  // AI labs and assistants
  'AnthropicAI', 'claudeai', 'OpenAI', 'OpenAIDevs', 'SpaceXAI', 'grok', 'GoogleDeepMind', 'GoogleAI', 'GeminiApp',
  'GoogleLabs', 'AIatMeta', 'Muse', 'MistralAI', 'deepseek_ai', 'Alibaba_Qwen', 'Kimi_Moonshot', 'Zai_org',
  'perplexity_ai', 'NousResearch',
  // builder tools and model platforms
  'cursor_ai', 'vercel', 'v0', 'Replit', 'Lovable', 'boltdotnew', 'huggingface', 'OpenRouter', 'ollama',
  'LangChain', 'llama_index', 'runwayml', 'pika_labs', 'midjourney', 'ElevenLabs', 'HeyGen',
  // automation, CRM and GTM tools
  'n8n_io', 'zapier', 'make_hq', 'gohighlevel', 'HubSpot', 'salesforce', 'attio', '11x_official', 'instantlyai',
];

export const DEFAULT_INSIDER_ACCOUNTS = [
  // lab leaders and researchers
  'sama', 'gdb', 'OfficialLoganK', 'demishassabis', 'sundarpichai', 'JeffDean', 'ylecun', 'alexalbert__', 'mikeyk',
  'bcherny', '_catwu', 'karpathy', 'AravSrinivas', 'amasad', 'rauchg', 'alexandr_wang', 'Ahmad_Al_Dahle', 'DrJimFan',
  'hardmaru', 'jeremyphoward', 'OriolVinyalsML', 'npew', 'trq212', 'aidan_mclau',
  // AI news, leaks and benchmarks
  'testingcatalog', 'btibor91', 'legit_api', 'kimmonismus', 'rowancheung', 'TheRundownAI', '_akhaliq', 'AndrewCurran_',
  'apples_jimmy', 'scaling01', 'ArtificialAnlys', 'EpochAIResearch', 'arena', 'Techmeme',
  'TechCrunch', 'theinformation',
  // AI builders and explainers
  'swyx', 'simonw', 'emollick', 'levelsio', 'mattshumer_', 'bindureddy', 'deedydas', 'omarsar0', 'mreflow',
  'bilawalsidhu', 'LinusEkenstam', 'alliekmiller', 'rohanpaul_ai', 'dr_cintas', 'minchoi', 'godofprompt',
  'hwchase17', 'jerryjliu0', 'yoheinakajima', 'mckaywrigley', 'rileybrown', 'steipete', 'nutlope', 'joaomdmoura',
  'Teknium',
  // investors
  'venturetwins', 'a16z', 'ycombinator', 'garrytan', 'paulg', 'pmarca', 'sriramk', 'saranormous',
  'eladgil', 'jaltma',
  // GTM, SaaS and creator-business operators
  'jasonlk', 'hnshah', 'dharmesh', 'bhalligan', 'searchbrat', 'randfish', 'ttunguz', 'levie', 'nathanbarry',
  'lennysan', 'gregisenberg', 'alexhormozi', 'shaanvp', 'thesamparr', 'jspujji', 'SahilBloom', 'Codie_Sanchez',
  'businessbarista', 'dickiebush', 'thejustinwelsh', 'AaronxShepherd', 'dan__rosenthal', 'gat0rtheskater',
];

/** Launch wording in an official account's post. */
export const LAUNCH_RE =
  /\b(introducing|now available|now live|is (here|live|out)|launch(es|ed|ing)?|rolling out|just (shipped|launched|released)|meet |available (today|now)|we('re| are) (releasing|launching|shipping)|new model|you can now|say hi to|welcome)\b/i;

/** A stored repost: pulse-ingest writes its body as "RT @author: <reposted text>". */
export const REPOST_RE = /^RT @\w+: /;

export const normalizeHandle = (h: string) => h.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').split(/[/?#\s]/)[0].toLowerCase();
