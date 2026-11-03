const MALE_FIRST_NAMES = new Set([
  'aaron', 'adam', 'adrian', 'alexander', 'andrew', 'anthony', 'arthur',
  'benjamin', 'bradley', 'brandon', 'brian', 'caleb', 'cameron', 'charles',
  'christian', 'christopher', 'daniel', 'david', 'dominic', 'dylan', 'edward',
  'elijah', 'ethan', 'evan', 'frank', 'gabriel', 'george', 'henry', 'isaac',
  'jack', 'jacob', 'james', 'jason', 'jeremy', 'john', 'jonathan', 'joseph',
  'joshua', 'julian', 'kevin', 'liam', 'logan', 'lucas', 'luke', 'mark',
  'mason', 'matthew', 'michael', 'nathan', 'nicholas', 'noah', 'oliver',
  'patrick', 'paul', 'peter', 'philip', 'richard', 'robert', 'ryan', 'samuel',
  'scott', 'sean', 'sebastian', 'stephen', 'steven', 'thomas', 'timothy',
  'tyler', 'victor', 'wayne', 'william', 'zachary',
]);

const FEMALE_FIRST_NAMES = new Set([
  'abigail', 'alexandra', 'alice', 'alyssa', 'amanda', 'amelia', 'amy', 'anna',
  'ashley', 'ava', 'barbara', 'brianna', 'camila', 'caroline', 'charlotte',
  'chloe', 'claire', 'danielle', 'diana', 'elena', 'elizabeth', 'ella', 'emily',
  'emma', 'evelyn', 'grace', 'hannah', 'isabella', 'jane', 'jasmine',
  'jennifer', 'jessica', 'julia', 'katherine', 'laura', 'lily', 'linda',
  'madison', 'maria', 'megan', 'melissa', 'mia', 'michelle', 'natalie',
  'nicole', 'olivia', 'rachel', 'rebecca', 'samantha', 'sarah', 'sophia',
  'stephanie', 'susan', 'victoria', 'zoe',
]);

const SETTINGS = [
  'soft daylight near a large window',
  'outdoor urban background softly blurred',
  'warm coworking lounge background out of focus',
  'neutral studio backdrop with subtle texture',
  'modern lobby background with natural light',
  'bookcase background softly blurred',
  'simple warm gray background',
  'bright office hallway background out of focus',
];

const ATTIRE = [
  'tailored blazer over a plain shirt',
  'smart casual knit sweater',
  'button-down shirt without a tie',
  'business casual jacket',
  'minimal dark crew-neck top',
  'light collared shirt',
  'casual blazer with an open collar',
  'professional blouse or shirt',
];

const CAMERA = [
  'three-quarter angle',
  'straight-on LinkedIn-style portrait',
  'slight side angle',
  'relaxed candid portrait angle',
  'shoulders-up portrait with slight head turn',
];

const AGE_RANGES = ['late 20s', 'early 30s', 'mid 30s', 'early 40s', 'mid 40s'];

export type AvatarGender = 'male' | 'female' | 'unspecified';

export function inferGenderFromName(displayName: string): AvatarGender {
  const firstName = displayName
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');

  if (!firstName) return 'unspecified';
  if (MALE_FIRST_NAMES.has(firstName)) return 'male';
  if (FEMALE_FIRST_NAMES.has(firstName)) return 'female';
  return 'unspecified';
}

export function parseInferredGender(text: string): AvatarGender {
  const lower = text.toLowerCase();
  if (lower.includes('female')) return 'female';
  if (lower.includes('male')) return 'male';
  return 'unspecified';
}

export function buildMailboxAvatarPrompt(input: {
  displayName: string;
  jobTitle?: string;
  gender?: AvatarGender | string;
  ethnicity?: string;
}): string {
  const seed = hashString(`${input.displayName}|${input.jobTitle || ''}`);
  const inferredGender = normalizeGender(input.gender) || inferGenderFromName(input.displayName);
  const subject =
    inferredGender === 'male' ? 'man' :
    inferredGender === 'female' ? 'woman' :
    'adult professional';
  const genderInstruction =
    inferredGender === 'male' ? 'The subject must read clearly as male.' :
    inferredGender === 'female' ? 'The subject must read clearly as female.' :
    'Do not exaggerate gendered styling; make the portrait natural and realistic.';
  const ethnicity = input.ethnicity?.trim() ? `${input.ethnicity.trim()} ` : '';
  const title = input.jobTitle?.trim() || 'business professional';

  return [
    `Photorealistic professional headshot of a ${ethnicity}${subject} named ${input.displayName}, working as a ${title}.`,
    genderInstruction,
    `Age range: ${pick(AGE_RANGES, seed + 1)}.`,
    `Setting: ${pick(SETTINGS, seed + 2)}.`,
    `Wardrobe: ${pick(ATTIRE, seed + 3)}.`,
    `Camera: ${pick(CAMERA, seed + 4)}, shoulders-up framing, natural facial expression.`,
    'Realistic LinkedIn profile photo, natural skin texture, no identical stock-photo look, no family resemblance to other generated portraits.',
    'Do NOT include text, watermarks, logos, badges, name tags, extra people, or overlays.',
  ].join(' ');
}

function normalizeGender(value: string | undefined): AvatarGender | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes('female')) return 'female';
  if (lower.includes('male')) return 'male';
  return null;
}

function pick<T>(items: T[], seed: number): T {
  return items[Math.abs(seed) % items.length];
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return hash;
}
