/**
 * AcaViralVideo — 75-second vertical viral video to promote ACA.
 *
 * 6-scene narrative arc: Hook → Problem → Bridge → Solution → Proof → CTA
 * Format: 1080×1920 (9:16), 30fps, 75 seconds (2250 frames)
 *
 * Pure motion-graphics composition — no external assets required.
 * Designed for TikTok / YouTube Shorts / Instagram Reels.
 */

import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
  Series,
} from 'remotion';
import { TransitionSeries, linearTiming, springTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { noise2D } from '@remotion/noise';

// ─── Brand ────────────────────────────────────────────────────────────────────

const BRAND = {
  accent: '#D4AF37',       // Gold — ACA primary accent
  blue: '#0066FF',         // Electric blue — solution/energy
  dark: '#0A0A0F',         // Near-black — problem scenes
  darkBlue: '#0D1B2A',     // Dark navy — solution bg
  white: '#FFFFFF',
  gray: '#A0A8B8',
  green: '#22C55E',        // Proof/success green
  font: 'Inter, system-ui, sans-serif',
};

const FPS = 30;

// ─── Scene durations (seconds → frames) ──────────────────────────────────────

const SCENE_DURATIONS = {
  hook:     Math.round(3  * FPS),  //  90 frames — 0:00–0:03
  problem:  Math.round(12 * FPS),  // 360 frames — 0:03–0:15
  bridge:   Math.round(10 * FPS),  // 300 frames — 0:15–0:25
  solution: Math.round(15 * FPS),  // 450 frames — 0:25–0:40
  proof:    Math.round(15 * FPS),  // 450 frames — 0:40–0:55
  cta:      Math.round(20 * FPS),  // 600 frames — 0:55–1:15
};

const TRANSITION_FRAMES = 10;

// ─── Shared Utilities ─────────────────────────────────────────────────────────

function usePunchIn(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 14, stiffness: 180, mass: 0.7 } });
}

function useSlideUp(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 18, stiffness: 120, mass: 0.8 } });
  return {
    opacity: interpolate(progress, [0, 1], [0, 1]),
    translateY: interpolate(progress, [0, 1], [50, 0]),
  };
}

function useFadeIn(delay = 0, durationFrames = 20) {
  const frame = useCurrentFrame();
  return interpolate(frame, [delay, delay + durationFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/** Animated noise-driven gradient orb */
const GradientOrb: React.FC<{ x: number; y: number; color: string; size: number; seed: string }> = ({
  x, y, color, size, seed,
}) => {
  const frame = useCurrentFrame();
  const dx = noise2D(seed + 'x', frame * 0.005, 0) * 8;
  const dy = noise2D(seed + 'y', 0, frame * 0.005) * 8;
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x + dx}%`,
        top: `${y + dy}%`,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color}60 0%, transparent 70%)`,
        transform: 'translate(-50%, -50%)',
        filter: 'blur(60px)',
        pointerEvents: 'none',
      }}
    />
  );
};

/** Pulsing accent line */
const AccentLine: React.FC<{ delay?: number }> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 20, stiffness: 200 } });
  const width = interpolate(progress, [0, 1], [0, 120]);
  return (
    <div
      style={{
        height: 4,
        width,
        background: `linear-gradient(90deg, ${BRAND.accent}, ${BRAND.blue})`,
        borderRadius: 2,
        marginTop: 24,
      }}
    />
  );
};

/** Bold on-screen label chip */
const LabelChip: React.FC<{ text: string; delay?: number; color?: string }> = ({
  text, delay = 0, color = BRAND.blue,
}) => {
  const opacity = useFadeIn(delay);
  return (
    <div style={{ opacity }}>
      <div
        style={{
          display: 'inline-block',
          background: `${color}22`,
          border: `1.5px solid ${color}66`,
          borderRadius: 100,
          padding: '10px 28px',
          fontSize: 26,
          fontWeight: 700,
          color,
          fontFamily: BRAND.font,
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      >
        {text}
      </div>
    </div>
  );
};

// ─── SCENE 1: HOOK (3s) ───────────────────────────────────────────────────────
// "You built the AI. Where are the clients?"

const SceneHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const line1Prog = spring({ frame, fps, config: { damping: 12, stiffness: 200, mass: 0.6 } });
  const line2Prog = spring({ frame: Math.max(0, frame - 15), fps, config: { damping: 12, stiffness: 200, mass: 0.6 } });

  const line1Scale = interpolate(line1Prog, [0, 1], [0.7, 1]);
  const line1Opacity = interpolate(line1Prog, [0, 1], [0, 1]);
  const line2Scale = interpolate(line2Prog, [0, 1], [0.7, 1]);
  const line2Opacity = interpolate(line2Prog, [0, 1], [0, 1]);

  // Subtle camera shake to convey tension
  const shakeX = noise2D('hk-shake-x', frame * 0.3, 0) * 3;
  const shakeY = noise2D('hk-shake-y', 0, frame * 0.3) * 2;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.dark,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 80px',
        transform: `translate(${shakeX}px, ${shakeY}px)`,
      }}
    >
      {/* Background tension gradient */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at 50% 40%, #1a0505 0%, ${BRAND.dark} 70%)`,
        }}
      />

      {/* Red accent glow — frustration */}
      <GradientOrb x={50} y={35} color="#FF2222" size={600} seed="hook-red" />

      <div style={{ zIndex: 1, textAlign: 'center' }}>
        <div
          style={{
            opacity: line1Opacity,
            transform: `scale(${line1Scale})`,
            fontSize: 96,
            fontWeight: 900,
            color: BRAND.white,
            fontFamily: BRAND.font,
            lineHeight: 1.05,
            letterSpacing: -3,
            marginBottom: 24,
          }}
        >
          You built the AI.
        </div>
        <div
          style={{
            opacity: line2Opacity,
            transform: `scale(${line2Scale})`,
            fontSize: 80,
            fontWeight: 900,
            color: BRAND.accent,
            fontFamily: BRAND.font,
            lineHeight: 1.1,
            letterSpacing: -2,
          }}
        >
          Where are the clients?
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 2: PROBLEM (12s) ───────────────────────────────────────────────────
// Empty inbox, cold DMs ignored, frustration montage

const SceneProblem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const s1 = useSlideUp(0);
  const s2 = useSlideUp(20);
  const s3 = useSlideUp(40);

  // Fake inbox "0 new inquiries" counter
  const inboxProg = spring({ frame: Math.max(0, frame - 30), fps, config: { damping: 20, stiffness: 100 } });
  const inboxOpacity = useFadeIn(25, 15);

  // Flicker effect at scene start for tension
  const flicker = frame < 12 && frame % 4 < 2 ? 0.7 : 1;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.dark,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 72px',
        opacity: flicker,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at 30% 60%, #0A0520 0%, ${BRAND.dark} 60%)`,
        }}
      />
      <GradientOrb x={20} y={70} color="#3311AA" size={500} seed="prob-orb1" />

      <div style={{ zIndex: 1, width: '100%' }}>
        {/* Top label */}
        <div style={{ marginBottom: 48, textAlign: 'center' }}>
          <LabelChip text="The Problem" color="#FF4444" delay={5} />
        </div>

        {/* Main statement */}
        <div
          style={{
            opacity: s1.opacity,
            transform: `translateY(${s1.translateY}px)`,
            fontSize: 72,
            fontWeight: 900,
            color: BRAND.white,
            fontFamily: BRAND.font,
            lineHeight: 1.1,
            letterSpacing: -2,
            marginBottom: 40,
            textAlign: 'center',
          }}
        >
          The real problem isn't your skills.
        </div>

        {/* Sub-copy */}
        <div
          style={{
            opacity: s2.opacity,
            transform: `translateY(${s2.translateY}px)`,
            fontSize: 38,
            fontWeight: 500,
            color: BRAND.gray,
            fontFamily: BRAND.font,
            lineHeight: 1.5,
            marginBottom: 48,
            textAlign: 'center',
          }}
        >
          You can build chatbots, automate workflows, create AI agents...
        </div>

        {/* Fake inbox widget */}
        <div
          style={{
            opacity: inboxOpacity,
            transform: `translateY(${interpolate(inboxProg, [0, 1], [30, 0])}px)`,
            background: '#12121E',
            border: '1px solid #2A2A3E',
            borderRadius: 20,
            padding: '32px 40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 40,
          }}
        >
          <div>
            <div style={{ fontSize: 28, fontWeight: 600, color: BRAND.gray, fontFamily: BRAND.font }}>
              Inbox
            </div>
            <div style={{ fontSize: 22, color: '#555', fontFamily: BRAND.font, marginTop: 6 }}>
              Today
            </div>
          </div>
          <div
            style={{
              fontSize: 64,
              fontWeight: 900,
              color: '#FF4444',
              fontFamily: BRAND.font,
              letterSpacing: -2,
            }}
          >
            0
          </div>
        </div>

        {/* Punch line */}
        <div
          style={{
            opacity: s3.opacity,
            transform: `translateY(${s3.translateY}px)`,
            fontSize: 44,
            fontWeight: 800,
            color: BRAND.accent,
            fontFamily: BRAND.font,
            lineHeight: 1.2,
            textAlign: 'center',
            letterSpacing: -1,
          }}
        >
          None of that matters if you can't get clients through the door.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 3: BRIDGE (10s) ────────────────────────────────────────────────────
// Split: old way (hustle) vs new way (system)

const SceneBridge: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerProg = spring({ frame, fps, config: { damping: 16, stiffness: 140 } });
  const leftProg = spring({ frame: Math.max(0, frame - 20), fps, config: { damping: 18, stiffness: 120 } });
  const rightProg = spring({ frame: Math.max(0, frame - 35), fps, config: { damping: 18, stiffness: 120 } });

  const dividerOpacity = useFadeIn(30, 20);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#080B14',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 60px',
      }}
    >
      <GradientOrb x={15} y={50} color="#1133AA" size={500} seed="bridge-left" />
      <GradientOrb x={85} y={50} color={BRAND.accent} size={500} seed="bridge-right" />

      <div style={{ zIndex: 1, width: '100%' }}>
        {/* Header */}
        <div
          style={{
            opacity: interpolate(headerProg, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(headerProg, [0, 1], [30, 0])}px)`,
            fontSize: 72,
            fontWeight: 900,
            color: BRAND.white,
            fontFamily: BRAND.font,
            letterSpacing: -2,
            lineHeight: 1.1,
            textAlign: 'center',
            marginBottom: 60,
          }}
        >
          There's a better way.
        </div>

        {/* Split panel */}
        <div style={{ display: 'flex', gap: 20, width: '100%' }}>
          {/* OLD WAY */}
          <div
            style={{
              flex: 1,
              opacity: interpolate(leftProg, [0, 1], [0, 1]),
              transform: `translateX(${interpolate(leftProg, [0, 1], [-40, 0])}px)`,
              background: '#1A0A0A',
              border: '1px solid #3A1515',
              borderRadius: 24,
              padding: '36px 28px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 52, marginBottom: 16 }}>😩</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#FF6666', fontFamily: BRAND.font, marginBottom: 16 }}>
              Old Way
            </div>
            {['Cold DMing all day', 'Begging for work', 'Zero systems'].map((t, i) => (
              <div
                key={i}
                style={{
                  fontSize: 26,
                  color: '#886666',
                  fontFamily: BRAND.font,
                  marginBottom: 10,
                  lineHeight: 1.4,
                }}
              >
                ✗ {t}
              </div>
            ))}
          </div>

          {/* Divider */}
          <div
            style={{
              opacity: dividerOpacity,
              width: 3,
              background: `linear-gradient(to bottom, transparent, ${BRAND.accent}, transparent)`,
              borderRadius: 4,
              flexShrink: 0,
            }}
          />

          {/* NEW WAY */}
          <div
            style={{
              flex: 1,
              opacity: interpolate(rightProg, [0, 1], [0, 1]),
              transform: `translateX(${interpolate(rightProg, [0, 1], [40, 0])}px)`,
              background: '#0A1A0A',
              border: `1px solid ${BRAND.accent}44`,
              borderRadius: 24,
              padding: '36px 28px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 52, marginBottom: 16 }}>⚡</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: BRAND.accent, fontFamily: BRAND.font, marginBottom: 16 }}>
              New Way
            </div>
            {['Clients come to you', 'Proven system', 'Scale without hustle'].map((t, i) => (
              <div
                key={i}
                style={{
                  fontSize: 26,
                  color: '#88AA88',
                  fontFamily: BRAND.font,
                  marginBottom: 10,
                  lineHeight: 1.4,
                }}
              >
                ✓ {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 4: SOLUTION (15s) ──────────────────────────────────────────────────
// ACA reveal — platform walkthrough

const SceneSolution: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoProg = spring({ frame, fps, config: { damping: 14, stiffness: 160, mass: 0.8 } });
  const taglineProg = spring({ frame: Math.max(0, frame - 25), fps, config: { damping: 18, stiffness: 120 } });

  const features = [
    { icon: '🎯', text: 'Land clients consistently', delay: 40 },
    { icon: '🤖', text: 'AI-powered outreach system', delay: 55 },
    { icon: '📈', text: 'Deliver jaw-dropping results', delay: 70 },
    { icon: '🔄', text: 'Scale without burning out', delay: 85 },
  ];

  // Background pulse
  const pulse = interpolate(
    Math.sin((frame / fps) * Math.PI * 0.8),
    [-1, 1],
    [0.3, 0.6],
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.darkBlue,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 72px',
      }}
    >
      {/* Energy background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at 50% 30%, ${BRAND.blue}${Math.round(pulse * 255).toString(16).padStart(2, '0')} 0%, transparent 65%)`,
        }}
      />
      <GradientOrb x={80} y={80} color={BRAND.accent} size={400} seed="sol-gold" />

      <div style={{ zIndex: 1, width: '100%', textAlign: 'center' }}>
        {/* ACA Logo wordmark */}
        <div
          style={{
            opacity: interpolate(logoProg, [0, 1], [0, 1]),
            transform: `scale(${interpolate(logoProg, [0, 1], [0.75, 1])})`,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              display: 'inline-block',
              background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.blue})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontSize: 120,
              fontWeight: 900,
              fontFamily: BRAND.font,
              letterSpacing: -4,
            }}
          >
            ACA
          </div>
        </div>

        {/* Tagline */}
        <div
          style={{
            opacity: interpolate(taglineProg, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(taglineProg, [0, 1], [20, 0])}px)`,
            fontSize: 38,
            fontWeight: 700,
            color: BRAND.white,
            fontFamily: BRAND.font,
            letterSpacing: -1,
            marginBottom: 8,
          }}
        >
          AI Client Acquisition
        </div>

        <div
          style={{
            opacity: interpolate(taglineProg, [0, 1], [0, 1]),
            fontSize: 28,
            color: BRAND.gray,
            fontFamily: BRAND.font,
            marginBottom: 56,
          }}
        >
          Built specifically for AI agency owners
        </div>

        {/* Feature list */}
        {features.map((f, i) => {
          const prog = spring({
            frame: Math.max(0, frame - f.delay),
            fps,
            config: { damping: 18, stiffness: 130 },
          });
          return (
            <div
              key={i}
              style={{
                opacity: interpolate(prog, [0, 1], [0, 1]),
                transform: `translateX(${interpolate(prog, [0, 1], [-30, 0])}px)`,
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                background: '#FFFFFF0A',
                border: `1px solid ${BRAND.blue}33`,
                borderRadius: 16,
                padding: '24px 32px',
                marginBottom: 16,
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 40 }}>{f.icon}</span>
              <span
                style={{
                  fontSize: 34,
                  fontWeight: 600,
                  color: BRAND.white,
                  fontFamily: BRAND.font,
                  letterSpacing: -0.5,
                }}
              >
                {f.text}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 5: PROOF (15s) ─────────────────────────────────────────────────────
// Counter animations — $0 → $12k/mo, 3 → 11 clients

const CountUp: React.FC<{ target: number; delay: number; prefix?: string; suffix?: string }> = ({
  target, delay, prefix = '', suffix = '',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const prog = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 20, stiffness: 60, mass: 1.2 },
  });
  const value = Math.round(interpolate(prog, [0, 1], [0, target]));
  return (
    <>{prefix}{value.toLocaleString()}{suffix}</>
  );
};

const SceneProof: React.FC = () => {
  const { fps } = useVideoConfig();

  const proofCards = [
    {
      before: '$0/mo',
      after: { target: 12000, prefix: '$', suffix: '/mo' },
      label: 'in 60 days',
      delay: 10,
    },
    {
      before: '3 clients',
      after: { target: 11, prefix: '', suffix: ' clients' },
      label: 'in one quarter',
      delay: 60,
    },
    {
      before: 'trading time',
      after: { target: 50000, prefix: '$', suffix: '/mo' },
      label: 'consistent revenue',
      delay: 120,
    },
  ];

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#060B0F',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 64px',
      }}
    >
      <GradientOrb x={50} y={20} color={BRAND.green} size={500} seed="proof-green" />
      <GradientOrb x={80} y={80} color={BRAND.accent} size={300} seed="proof-gold" />

      <div style={{ zIndex: 1, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <LabelChip text="Real Results" color={BRAND.green} delay={0} />
        </div>

        <div
          style={{
            fontSize: 52,
            fontWeight: 900,
            color: BRAND.white,
            fontFamily: BRAND.font,
            letterSpacing: -2,
            textAlign: 'center',
            marginBottom: 48,
            lineHeight: 1.1,
          }}
        >
          Agency owners using ACA are hitting:
        </div>

        {proofCards.map((card, i) => {
          const frame = 0; // Will be overridden by Sequence
          return (
            <ProofCard key={i} card={card} index={i} />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const ProofCard: React.FC<{ card: any; index: number }> = ({ card, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const prog = spring({
    frame: Math.max(0, frame - card.delay),
    fps,
    config: { damping: 16, stiffness: 140 },
  });

  const target = card.after.target;
  const countProg = spring({
    frame: Math.max(0, frame - card.delay - 5),
    fps,
    config: { damping: 22, stiffness: 55, mass: 1.4 },
  });
  const countValue = Math.round(interpolate(countProg, [0, 1], [0, target]));

  return (
    <div
      style={{
        opacity: interpolate(prog, [0, 1], [0, 1]),
        transform: `translateY(${interpolate(prog, [0, 1], [30, 0])}px) scale(${interpolate(prog, [0, 1], [0.95, 1])})`,
        background: 'linear-gradient(135deg, #0D1F0D 0%, #0A150A 100%)',
        border: `1.5px solid ${BRAND.green}44`,
        borderRadius: 20,
        padding: '28px 36px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <div style={{ fontSize: 22, color: '#666', fontFamily: BRAND.font, textDecoration: 'line-through', marginBottom: 6 }}>
          {card.before}
        </div>
        <div style={{ fontSize: 52, fontWeight: 900, color: BRAND.green, fontFamily: BRAND.font, letterSpacing: -2, lineHeight: 1 }}>
          {card.after.prefix}{countValue.toLocaleString()}{card.after.suffix}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 22, color: BRAND.gray, fontFamily: BRAND.font }}>{card.label}</div>
        <div style={{ fontSize: 36, marginTop: 8 }}>📈</div>
      </div>
    </div>
  );
};

// ─── SCENE 6: CTA (20s) ───────────────────────────────────────────────────────
// Direct camera, urgency, ACA link

const SceneCta: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoProg = spring({ frame, fps, config: { damping: 14, stiffness: 150 } });
  const lineProg = spring({ frame: Math.max(0, frame - 20), fps, config: { damping: 18, stiffness: 110 } });
  const urlProg = spring({ frame: Math.max(0, frame - 55), fps, config: { damping: 20, stiffness: 130 } });
  const btnProg = spring({ frame: Math.max(0, frame - 75), fps, config: { damping: 16, stiffness: 160 } });

  // Pulsing CTA button
  const btnPulse = interpolate(
    Math.sin((frame / fps) * Math.PI * 1.2),
    [-1, 1],
    [0.92, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Animated background sweep
  const sweepPos = interpolate(frame, [0, fps * 20], [-100, 200], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.dark,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 72px',
      }}
    >
      {/* Animated sweep background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(135deg, transparent ${sweepPos - 30}%, ${BRAND.blue}18 ${sweepPos}%, ${BRAND.accent}12 ${sweepPos + 20}%, transparent ${sweepPos + 50}%)`,
        }}
      />
      <GradientOrb x={50} y={50} color={BRAND.blue} size={700} seed="cta-blue" />
      <GradientOrb x={80} y={20} color={BRAND.accent} size={350} seed="cta-gold" />

      <div style={{ zIndex: 1, width: '100%', textAlign: 'center' }}>
        {/* ACA logo */}
        <div
          style={{
            opacity: interpolate(logoProg, [0, 1], [0, 1]),
            transform: `scale(${interpolate(logoProg, [0, 1], [0.7, 1])})`,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: 'inline-block',
              background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.blue})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontSize: 110,
              fontWeight: 900,
              fontFamily: BRAND.font,
              letterSpacing: -4,
            }}
          >
            ACA
          </div>
        </div>

        {/* Tagline */}
        <div
          style={{
            opacity: interpolate(logoProg, [0, 1], [0, 1]),
            fontSize: 30,
            color: BRAND.gray,
            fontFamily: BRAND.font,
            letterSpacing: 1,
            textTransform: 'uppercase',
            marginBottom: 52,
          }}
        >
          Get Clients. Deliver Results. Scale.
        </div>

        {/* Main CTA copy */}
        <div
          style={{
            opacity: interpolate(lineProg, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(lineProg, [0, 1], [24, 0])}px)`,
            fontSize: 58,
            fontWeight: 900,
            color: BRAND.white,
            fontFamily: BRAND.font,
            lineHeight: 1.1,
            letterSpacing: -2,
            marginBottom: 20,
          }}
        >
          Your AI skills deserve to be paid for.
        </div>

        <div
          style={{
            opacity: interpolate(lineProg, [0, 1], [0, 1]),
            fontSize: 36,
            fontWeight: 500,
            color: BRAND.gray,
            fontFamily: BRAND.font,
            lineHeight: 1.5,
            marginBottom: 52,
          }}
        >
          Stop scrolling. Start landing clients this week.
        </div>

        {/* URL chip */}
        <div
          style={{
            opacity: interpolate(urlProg, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(urlProg, [0, 1], [20, 0])}px)`,
            background: '#FFFFFF10',
            border: `1px solid ${BRAND.accent}55`,
            borderRadius: 16,
            padding: '20px 40px',
            marginBottom: 28,
            fontSize: 32,
            fontFamily: BRAND.font,
            color: BRAND.accent,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          🔗 Link in bio
        </div>

        {/* Try free CTA button */}
        <div
          style={{
            opacity: interpolate(btnProg, [0, 1], [0, 1]),
            transform: `scale(${interpolate(btnProg, [0, 1], [0.85, btnPulse])})`,
            display: 'inline-block',
            background: `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.accent})`,
            borderRadius: 100,
            padding: '32px 72px',
            fontSize: 42,
            fontWeight: 900,
            color: BRAND.white,
            fontFamily: BRAND.font,
            letterSpacing: -0.5,
            boxShadow: `0 0 60px ${BRAND.blue}44, 0 0 30px ${BRAND.accent}33`,
          }}
        >
          Try ACA Free →
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── ROOT COMPOSITION ─────────────────────────────────────────────────────────

export const AcaViralVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.dark }}>
      <TransitionSeries>
        {/* Scene 1: Hook */}
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.hook}>
          <SceneHook />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={wipe({ direction: 'from-bottom' })}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 2: Problem */}
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.problem}>
          <SceneProblem />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: 'from-right' })}
          timing={springTiming({ durationInFrames: TRANSITION_FRAMES + 5 })}
        />

        {/* Scene 3: Bridge */}
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.bridge}>
          <SceneBridge />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 4: Solution */}
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.solution}>
          <SceneSolution />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={wipe({ direction: 'from-top' })}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 5: Proof */}
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.proof}>
          <SceneProof />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: 'from-left' })}
          timing={springTiming({ durationInFrames: TRANSITION_FRAMES + 5 })}
        />

        {/* Scene 6: CTA */}
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.cta}>
          <SceneCta />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
