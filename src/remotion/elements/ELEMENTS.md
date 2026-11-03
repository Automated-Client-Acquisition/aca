# Remotion Visual Elements Library

The elements library (`src/remotion/elements/`) provides reusable, composable visual building blocks for all Remotion compositions. Every element respects `BrandConfig` for consistent theming and is designed for both client-side preview (`@remotion/player`) and server-side rendering (video-renderer worker).

## Architecture

```
src/remotion/elements/
├── primitives/    ← Foundation: spring presets, animation hooks, entrance wrappers
├── text/          ← Text animation components (typewriter, glitch, wave, etc.)
├── backgrounds/   ← Animated background layers (particles, mesh gradient, orb)
├── overlays/      ← Post-processing layers (vignette, film grain, letterbox)
├── transitions/   ← Transition presentations for TransitionSeries
├── emphasis/      ← Highlight/annotation effects (circles, arrows, blur)
└── index.ts       ← Barrel — import everything from '@/remotion/elements'
```

**Layering order** in a composition (bottom to top):
1. Background (ParticleField / MeshGradient / GradientOrb)
2. Layout content (screenshots, text cards, stat cards, etc.)
3. Overlays (Vignette, FilmGrain, CinematicBars)

---

## 1. Primitives (`primitives/`)

Foundation layer — everything else builds on these.

### Spring Presets (`easing.ts`)

Named physics configs that replace scattered inline `{ damping, stiffness, mass }` objects.

| Preset | Feel | Use For |
|--------|------|---------|
| `smooth` | Natural, default | Most entrances, general animation |
| `snappy` | Quick, responsive | UI elements, buttons, immediate feedback |
| `bouncy` | Playful overshoot | Headlines, emphasis, character bounces |
| `gentle` | Slow, elegant | Background elements, gradual reveals |
| `heavy` | Weighty, deliberate | Large elements, dramatic reveals |

```tsx
import { SPRING_PRESETS } from '@/remotion/elements';

spring({ frame, fps, config: SPRING_PRESETS.bouncy });
```

### `useAnimationProgress(options?)` Hook

Returns a `0 → 1` spring-eased progress value. The fundamental hook for all animations.

```tsx
import { useAnimationProgress } from '@/remotion/elements';

const progress = useAnimationProgress({ delay: 10, preset: 'bouncy' });
// Use for opacity, scale, translateY, etc.
```

**Options:**
- `delay` — Frames before animation starts (default: `0`)
- `preset` — Named spring preset (default: `'smooth'`)
- `config` — Custom `SpringConfig` override

### `<FadeIn>` Component

Simple opacity entrance wrapper.

```tsx
<FadeIn delay={10} preset="smooth">
  <h1>Hello</h1>
</FadeIn>
```

**When to use:** Subtle content reveals, secondary text, background elements.

### `<SlideIn>` Component

Directional slide + fade entrance.

```tsx
<SlideIn direction="up" distance={30} delay={5} preset="snappy">
  <p>Slides up from 30px below</p>
</SlideIn>
```

**Props:** `direction` (up/down/left/right), `distance` (px, default 30)
**When to use:** List items, cards, anything that enters from an edge.

### `<ScaleIn>` Component

Scale + fade entrance — element grows from small to full size.

```tsx
<ScaleIn from={0.7} offsetY={20} preset="bouncy">
  <div>Scales in with bounce</div>
</ScaleIn>
```

**Props:** `from` (initial scale, default 0.7), `offsetY` (vertical offset px, default 20)
**When to use:** Headlines, hero elements, attention-grabbing entrances.

### `<Stagger>` Component

Wraps an array of children with staggered animation delays — creates a wave entrance.

```tsx
<Stagger staggerDelay={8} animation="slide_up" preset="smooth">
  {items.map(item => <Card key={item.id}>{item.text}</Card>)}
</Stagger>
```

**Props:**
- `staggerDelay` — Frames between each child (default: `8`)
- `initialDelay` — Frames before first child (default: `0`)
- `animation` — `'fade'` | `'slide_up'` | `'slide_down'` | `'slide_left'` | `'scale'`
- `preset` — Spring preset for each child

**When to use:** Lists, bullet points, grid items, any group entering sequentially.
**Replaces:** Manual `items.map((item, i) => { const delay = i * STAGGER; ... })` patterns in ListReveal, QuoteCard.

---

## 2. Text Animations (`text/`)

Specialized text rendering with built-in animation. Each accepts `brand: BrandConfig` for theming.

### `<TypewriterText>`

Character-by-character reveal with blinking cursor. Simulates real-time typing.

```tsx
<TypewriterText
  text="This text types itself..."
  brand={brand}
  charsPerSecond={20}
  showCursor={true}
  fontSize={48}
/>
```

**When to use:** Code-style reveals, technical content, "hacker" aesthetic, building suspense.
**Director `text_animation` value:** `'typewriter'`

### `<GlitchText>`

Random character scramble that resolves letter-by-letter into the final text. Each character cycles through random characters before settling on the real one.

```tsx
<GlitchText
  text="BREAKING NEWS"
  brand={brand}
  settleDelay={2}
  rgbSplit={true}
  fontSize={64}
/>
```

**Props:**
- `settleDelay` — Frames per character before it resolves (default: `2`)
- `rgbSplit` — Enables cyan/magenta color separation layers for extra digital glitch aesthetic

**When to use:** Dramatic headlines, tech/digital themes, reveal moments, hook shots.
**Director `text_animation` value:** `'glitch'`

### `<GradientText>`

Animated gradient that sweeps across the text. Uses CSS `background-clip: text` with a rotating linear gradient angle.

```tsx
<GradientText
  text="Premium Feature"
  brand={brand}
  speed={120}
  fontSize={56}
/>
```

**Props:**
- `speed` — Frames for a full 360° gradient rotation (default: `120`)
- `colors` — Override gradient colors as `[start, end]` (default: brand accent + lighter variant)

**When to use:** Premium/luxury content, titles, brand moments, closing CTAs.
**Director `text_animation` value:** `'gradient_sweep'`

### `<WaveText>`

Per-character sine wave motion. Each character oscillates vertically creating a continuous ripple.

```tsx
<WaveText
  text="Hello World"
  brand={brand}
  speed={0.15}
  amplitude={10}
  spread={0.5}
  fontSize={48}
/>
```

**Props:**
- `speed` — Oscillation frequency (default: `0.15`)
- `amplitude` — Wave height in px (default: `10`)
- `spread` — Phase offset between characters (default: `0.5`)

**When to use:** Playful/fun content, music-related, continuous ambient motion.
**Director `text_animation` value:** `'wave'`

### `<BounceText>`

Per-character spring bounce entrance with stagger. Characters pop up from below one by one.

```tsx
<BounceText
  text="Let's Go!"
  brand={brand}
  staggerDelay={2}
  preset="bouncy"
  fontSize={64}
/>
```

**When to use:** Energetic headlines, hooks, calls to action, fun/casual tone.
**Director `text_animation` value:** `'bounce'`

### `<CountUpText>`

Animated number counter that counts from 0 to a target value with spring physics.

```tsx
<CountUpText
  value={1250000}
  brand={brand}
  prefix="$"
  suffix="+"
  delay={15}
  fontSize={72}
/>
```

**Props:**
- `value` — Target number
- `prefix`/`suffix` — Before/after text (e.g., `$`, `%`, `K`)
- `decimals` — Decimal places (default: `0`)
- Numbers auto-format with `toLocaleString()` (e.g., `1,250,000`)

**When to use:** Statistics, revenue figures, growth metrics — always inside a `stat_card` layout.
**Replaces:** Inline counter logic in `StatCard.tsx`.

---

## 3. Backgrounds (`backgrounds/`)

Animated backgrounds rendered as the bottom-most layer (z-index 0). All accept `brand: BrandConfig` to derive colors from the brand palette.

**Important:** Backgrounds are **opt-in per shot** — the AI director decides which shots get a background based on mood. They are NOT default for every shot.

### `<ParticleField>`

~40 floating particles with Perlin noise positioning and 3 parallax depth layers. Creates organic, living depth.

```tsx
<ParticleField brand={brand} particleCount={40} intensity={0.5} />
```

**How it works:**
- Particles are small circles (2-6px) colored with `brand.accent_color`
- 3 depth layers with different drift speeds create parallax
- Positions driven by `noise2D()` from `@remotion/noise` for organic movement
- `intensity` controls opacity range (0-1)

**When to use:** Tech content, data/analytics themes, ambient motion behind text cards or stat cards.
**Director `background.type` value:** `'particles'`

### `<MeshGradient>`

"Apple keynote" style flowing color field. 3-4 large blurred radial gradients that drift slowly.

```tsx
<MeshGradient brand={brand} speed={1} intensity={0.5} />
```

**How it works:**
- 4 gradient points derived from `brand.accent_color` and `brand.primary_color`
- All points wrapped in `filter: blur(80px)` for smooth mesh
- Positions animate with `noise2D()` for organic drift
- Extended 20% beyond bounds to prevent edge artifacts

**When to use:** Premium/luxury content, gradient title shots, quote cards, brand moments.
**Director `background.type` value:** `'mesh_gradient'`

### `<GradientOrb>`

Single animated radial gradient — simpler and lighter than MeshGradient.

```tsx
<GradientOrb
  brand={brand}
  size={60}
  speed={1}
  position={[50, 50]}
  hueRotate={true}
/>
```

**Props:**
- `size` — Orb size as % of container (default: `60`)
- `position` — Starting [x%, y%] (default: `[50, 50]`)
- `hueRotate` — Animate hue shift (default: `true`)

**When to use:** Subtle accent glow, single-focus backgrounds, gradient title support.
**Director `background.type` value:** `'gradient_orbs'`

---

## 4. Overlays (`overlays/`)

Post-processing layers rendered on top of everything. All use `AbsoluteFill` with `pointerEvents: 'none'`.

### `<Vignette>`

Darkens the edges of the frame. The #1 way to make footage look cinematic.

```tsx
<Vignette intensity={0.35} />
```

**`intensity`** (0-1, default `0.35`): Higher = darker edges. `0.35` is subtle, `0.7` is dramatic.

**When to use:** Most shots benefit from a light vignette. Especially screenshot_fullscreen layouts where you want to draw the eye to the center. The director should use this on ~60% of shots.

### `<FilmGrain>`

SVG noise texture overlay that prevents the flat-digital look.

```tsx
<FilmGrain intensity={0.04} />
```

**`intensity`** (0-1, default `0.04`): Very subtle by default. `0.04` adds texture without being visible as noise. `0.15` creates obvious film grain.

**How it works:** Uses SVG `feTurbulence` fractal noise with a per-frame seed (`frame * 2654435761`) for animated grain that changes every frame.

**When to use:** Premium/cinematic content. Pairs well with vignette. The director should use this on ~30% of shots.

### `<CinematicBars>`

Subtle top/bottom gradient letterbox bars for cinematic framing.

```tsx
<CinematicBars barHeight="3%" opacity={0.3} />
```

**When to use:** Widescreen feel, dramatic moments, hook shots. Use sparingly — the director should use this on ~15% of shots.

---

## 5. Transitions (`transitions/`)

Full transition set for `@remotion/transitions` `TransitionSeries`.

### `getTransitionPresentation(type)`

Returns a `TransitionPresentation` for the given type. Used in `VideoEditorComposition` and the worker's `PresenterVideoComposition`.

```tsx
import { getTransitionPresentation, getDefaultTransitionDuration } from '@/remotion/elements';

const presentation = getTransitionPresentation('slam_zoom');
const duration = getDefaultTransitionDuration('slam_zoom'); // 8 frames
```

**Available types:**

| Type | Effect | Default Duration | Use For |
|------|--------|-----------------|---------|
| `cut_hard` | Instant cut (no transition) | 0 | Fast-paced editing, snap cuts |
| `fade` | Opacity crossfade | 15 frames | Calm transitions, endings |
| `crossfade` | Same as fade | 15 frames | Alias for fade |
| `slide_left` | Slides new content from right | 10 frames | Sequential progression |
| `slide_up` | Slides new content from bottom | 10 frames | Vertical progression |
| `zoom` | Scale up from center | 10 frames | Focus/emphasis transitions |
| `slam_zoom` | Fast scale with motion blur | 8 frames | High-energy, dramatic reveals |
| `snap_cut` | Scale down + slight rotation | 6 frames | Quick, punchy cuts |
| `whoosh` | Horizontal slide with speed blur | 8 frames | Fast-paced, dynamic content |

---

## 6. Emphasis (`emphasis/`)

Highlight/annotation effects for drawing attention to specific elements in screenshots.

### Highlight Functions (`highlights.ts`)

Pure math functions for computing animation values:

- `getCircleDrawProgress(frame, fps)` — SVG circle draw animation (0→1)
- `getCircleDimensions(bounds, padding)` — Compute circle overlay size
- `getUnderlineWidth(frame, fps)` — Underline draw width
- `getBlurAmount(frame, fps)` — Blur intensity for blur_except
- `getGlowSpread/Opacity(frame, fps)` — Glow pulse parameters
- `getArrowPosition(frame, fps)` — Arrow bounce offset
- `getMagnifyTransform(frame, fps)` — Magnifier scale

### `<HighlightLayer>`

React component that renders the appropriate highlight based on type.

```tsx
import { HighlightLayer } from '@/remotion/elements';

<HighlightLayer
  highlight={{ type: 'red_circle', target_element: '.price' }}
  bounds={{ x: 100, y: 200, width: 150, height: 40 }}
/>
```

**Available highlight types:**

| Type | Effect |
|------|--------|
| `red_circle` | Animated red circle drawn around element |
| `underline_draw` | Red underline that draws itself |
| `blur_except` | Blur everything except highlighted area |
| `glow_pulse` | Pulsing glow around element |
| `arrow` | Bouncing arrow pointing at element |
| `magnify` | Magnifying glass effect on element |

---

## Integration: How Elements Flow Through the Pipeline

### 1. Director Stage (AI Decision)

The director LLM receives the visual capabilities in its prompt and outputs per-shot JSON:

```json
{
  "layout": "text_card",
  "text_animation": "glitch",
  "background": { "type": "particles", "intensity": 0.4 },
  "overlay_config": { "vignette": true, "vignette_intensity": 0.3 }
}
```

The `text_animation`, `background`, and `overlay_config` fields are all optional — the director only adds them when appropriate for the shot's mood.

### 2. Output Transformer (`parseDirectorOutput`)

Passes shots through as-is — no transformation needed since the fields are stored directly on the Shot object.

### 3. Client Preview (`ShotPreviewComposition`)

Renders the elements in layer order:
1. `renderBackground(shot.background, brand)` → dispatches to ParticleField/MeshGradient/GradientOrb
2. `renderLayout(shot, ...)` → existing layout components (TextCard, StatCard, etc.)
3. Overlay config → optional Vignette, FilmGrain, CinematicBars

### 4. Worker Render (`video-renderer`)

The worker's `ShotRenderer.tsx` uses the same types and renders identical elements for production quality output.

---

## Type Extensions

All new fields are **optional on the `Shot` interface** — existing shots without them render exactly as before (no regressions).

```typescript
// src/remotion/presenter/types.ts (also mirrored in worker types)

type TextAnimationType =
  | 'spring_fade' | 'typewriter' | 'glitch' | 'wave' | 'bounce' | 'gradient_sweep';

type BackgroundType =
  | 'solid' | 'gradient' | 'particles' | 'mesh_gradient' | 'gradient_orbs';

interface BackgroundConfig {
  type: BackgroundType;
  intensity?: number; // 0-1
}

interface OverlayConfig {
  vignette?: boolean;
  vignette_intensity?: number; // 0-1
  grain?: boolean;
  grain_intensity?: number; // 0-1
  letterbox?: boolean;
}

interface Shot {
  // ... existing fields ...
  text_animation?: TextAnimationType;
  background?: BackgroundConfig;
  overlay_config?: OverlayConfig;
  decorations?: DecorationInstance[];
}

interface DecorationInstance {
  decoration_id: string;              // from DECORATION_CATALOG
  position: { x: number; y: number }; // percentage 0-100
  scale: number;                       // 1.0 = default
  rotation?: number;                   // degrees
  start_frame_offset?: number;         // delay from shot start
  duration_frames?: number | null;     // null = entire shot
  config?: Record<string, any>;        // decoration-specific overrides
}
```

---

## 7. Decorations (`decorations/`)

CapCut-style animated stickers, badges, emojis, and frames that add personality and engagement to shots. Each decoration is a self-contained Remotion component using programmatic SVG/CSS — no external assets.

### Architecture

```
src/remotion/elements/decorations/
├── types.ts                # DecorationComponentProps, DecorationMeta
├── catalog.ts              # DECORATION_CATALOG registry (pure data)
├── DecorationRenderer.tsx  # Maps decoration_id → component
├── DecorationLayer.tsx     # Positions decorations[] as overlays
├── index.ts                # Barrel export
├── arrows/                 # BouncingArrow, CurvedArrow, PointingHand
├── badges/                 # SubscribeBadge, NewBadge, StarBurst, FireIcon, CheckmarkBadge
├── social/                 # LikeHeart, ThumbsUp, ShareIcon, CommentBubble, FollowerCount
├── emphasis/               # Sparkles, ExclamationMarks, QuestionMarks, ZoomLines, SpeedLines
├── emojis/                 # AnimatedEmoji (generic — configurable emoji + animation)
└── frames/                 # NeonGlowFrame, PolaroidFrame, RoundedFrame
```

**Usage:**

```tsx
import { DecorationLayer, DECORATION_CATALOG } from '@/remotion/elements';
```

### Catalog & Registry

`DECORATION_CATALOG` is a pure-data registry mapping decoration IDs to metadata (name, category, description, tags, default scale). Components are resolved at render time by `DecorationRenderer`.

```tsx
import { DECORATION_CATALOG, getDecorationsByCategory } from '@/remotion/elements';

// Get all badges
const badges = getDecorationsByCategory('badges');
// => [{ id: 'subscribe_badge', name: 'Subscribe Badge', ... }, ...]
```

### DecorationLayer

Renders positioned decorations on top of layout content. Each decoration is wrapped in a `<Sequence>` for timing.

```tsx
<DecorationLayer
  decorations={shot.decorations}
  brand={brand}
  shotDurationFrames={90}
/>
```

Renders at **z-index 15** — between highlights (z:10) and text overlays (z:20).

### Available Decorations (24 total)

#### Arrows (3)

| ID | Name | Animation | Looping |
|----|------|-----------|---------|
| `bouncing_arrow` | Bouncing Arrow | Down-arrow bounces on 1s cycle | Yes |
| `curved_arrow` | Curved Arrow | SVG path draws itself on | No |
| `pointing_hand` | Pointing Hand | Side-to-side pointing gesture | Yes |

**When to use:** CTAs, drawing attention to specific content, directional cues.

#### Badges (5)

| ID | Name | Animation | Looping |
|----|------|-----------|---------|
| `subscribe_badge` | Subscribe Badge | Red button with scale pulse | Yes |
| `new_badge` | NEW Badge | Shine sweep across badge | Yes |
| `star_burst` | Star Burst | Rotating star shape | Yes |
| `fire_icon` | Fire Icon | SVG flame with organic flicker | Yes |
| `checkmark_badge` | Checkmark | Circle draws, then checkmark draws | No |

**When to use:** Announcements, trending content, success confirmation, CTAs.

#### Social (5)

| ID | Name | Animation | Looping |
|----|------|-----------|---------|
| `like_heart` | Like Heart | Heart pop with bounce | No |
| `thumbs_up` | Thumbs Up | Bounce-up entrance with rock | No |
| `share_icon` | Share Icon | Spring slide-in from left | No |
| `comment_bubble` | Comment Bubble | Bounce entrance + dot stagger | No |
| `follower_count` | Follower Count | "+1K" scale-up + float | No |

**When to use:** Engagement metrics, social proof, community moments.

#### Emphasis (5)

| ID | Name | Animation | Looping |
|----|------|-----------|---------|
| `sparkles` | Sparkles | Orbiting sparkle stars with pulse | Yes |
| `exclamation_marks` | Exclamation Marks | Staggered bouncing "!!!" | Yes |
| `question_marks` | Question Marks | Floating "???" with bob | Yes |
| `zoom_lines` | Zoom Lines | Radial lines emanating outward | Yes |
| `speed_lines` | Speed Lines | Horizontal manga speed lines | Yes |

**When to use:** Dramatic impact, action moments, curiosity hooks, highlighting importance.

#### Emojis (6)

All emojis use the generic `AnimatedEmoji` component with different `config` presets.

| ID | Emoji | Animation |
|----|-------|-----------|
| `emoji_fire` | 🔥 | bounce |
| `emoji_lightbulb` | 💡 | pulse |
| `emoji_lightning` | ⚡ | shake |
| `emoji_target` | 🎯 | bounce |
| `emoji_money` | 💰 | bounce |
| `emoji_rocket` | 🚀 | float (upward) |

**When to use:** Quick emotional accents — trending, ideas, speed, goals, revenue, growth.

#### Frames (3)

| ID | Name | Animation | Looping |
|----|------|-----------|---------|
| `neon_glow_frame` | Neon Glow Frame | Pulsing neon box-shadow | Yes |
| `polaroid_frame` | Polaroid Frame | Tilted entrance with shadow | No |
| `rounded_frame` | Rounded Frame | Hue-rotating border glow | Yes |

**When to use:** Highlighting content areas, photo-style framing, visual grouping.

### Director Integration

The AI director places decorations automatically via the `decorations` field in each shot's JSON:

```json
{
  "decorations": [
    {
      "decoration_id": "emoji_fire",
      "position": { "x": 90, "y": 10 },
      "scale": 1.0
    }
  ]
}
```

**Director rules:**
- 30-50% of shots get decorations (not every shot)
- Maximum 2 per shot
- Positioned at edges/corners to avoid covering center content
- Matched to content mood (hooks → fire/zoom_lines, CTA → subscribe_badge, etc.)

---

## Quick Reference: When to Use What

| Content Mood | Background | Text Animation | Overlays | Decorations |
|-------------|-----------|----------------|----------|-------------|
| Tech/data | `particles` | `typewriter` or `glitch` | vignette | `sparkles`, `emoji_lightning` |
| Premium/luxury | `mesh_gradient` | `gradient_sweep` | vignette + grain | `star_burst`, `neon_glow_frame` |
| Fun/energetic | none or `gradient_orbs` | `bounce` or `wave` | none | `emoji_fire`, `like_heart` |
| Dramatic hook | `particles` | `glitch` (rgbSplit) | vignette + letterbox | `zoom_lines`, `exclamation_marks` |
| Statistics | `gradient_orbs` | `spring_fade` (default) | vignette | `emoji_rocket`, `follower_count` |
| Closing CTA | `mesh_gradient` | `gradient_sweep` | grain | `subscribe_badge`, `bouncing_arrow` |
| Default/safe | none | `spring_fade` | light vignette | none |
