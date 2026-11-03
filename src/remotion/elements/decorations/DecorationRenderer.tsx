/**
 * DecorationRenderer — Maps decoration_id strings to their React components.
 */
import React from 'react';
import type { DecorationComponentProps } from './types';

// Arrows
import { BouncingArrow } from './arrows/BouncingArrow';
import { CurvedArrow } from './arrows/CurvedArrow';
import { PointingHand } from './arrows/PointingHand';

// Badges
import { SubscribeBadge } from './badges/SubscribeBadge';
import { NewBadge } from './badges/NewBadge';
import { StarBurst } from './badges/StarBurst';
import { FireIcon } from './badges/FireIcon';
import { CheckmarkBadge } from './badges/CheckmarkBadge';

// Social
import { LikeHeart } from './social/LikeHeart';
import { ThumbsUp } from './social/ThumbsUp';
import { ShareIcon } from './social/ShareIcon';
import { CommentBubble } from './social/CommentBubble';
import { FollowerCount } from './social/FollowerCount';

// Emphasis
import { Sparkles } from './emphasis/Sparkles';
import { ExclamationMarks } from './emphasis/ExclamationMarks';
import { QuestionMarks } from './emphasis/QuestionMarks';
import { ZoomLines } from './emphasis/ZoomLines';
import { SpeedLines } from './emphasis/SpeedLines';

// Emojis
import { AnimatedEmoji } from './emojis/AnimatedEmoji';

// Frames
import { NeonGlowFrame } from './frames/NeonGlowFrame';
import { PolaroidFrame } from './frames/PolaroidFrame';
import { RoundedFrame } from './frames/RoundedFrame';

const COMPONENT_MAP: Record<string, React.FC<DecorationComponentProps>> = {
  // Arrows
  bouncing_arrow: BouncingArrow,
  curved_arrow: CurvedArrow,
  pointing_hand: PointingHand,
  // Badges
  subscribe_badge: SubscribeBadge,
  new_badge: NewBadge,
  star_burst: StarBurst,
  fire_icon: FireIcon,
  checkmark_badge: CheckmarkBadge,
  // Social
  like_heart: LikeHeart,
  thumbs_up: ThumbsUp,
  share_icon: ShareIcon,
  comment_bubble: CommentBubble,
  follower_count: FollowerCount,
  // Emphasis
  sparkles: Sparkles,
  exclamation_marks: ExclamationMarks,
  question_marks: QuestionMarks,
  zoom_lines: ZoomLines,
  speed_lines: SpeedLines,
  // Emojis — all route through AnimatedEmoji with config
  emoji_fire: (props) => <AnimatedEmoji {...props} config={{ emoji: '🔥', animation: 'bounce', ...props.config }} />,
  emoji_lightbulb: (props) => <AnimatedEmoji {...props} config={{ emoji: '💡', animation: 'pulse', ...props.config }} />,
  emoji_lightning: (props) => <AnimatedEmoji {...props} config={{ emoji: '⚡', animation: 'shake', ...props.config }} />,
  emoji_target: (props) => <AnimatedEmoji {...props} config={{ emoji: '🎯', animation: 'bounce', ...props.config }} />,
  emoji_money: (props) => <AnimatedEmoji {...props} config={{ emoji: '💰', animation: 'bounce', ...props.config }} />,
  emoji_rocket: (props) => <AnimatedEmoji {...props} config={{ emoji: '🚀', animation: 'float', ...props.config }} />,
  // Frames
  neon_glow_frame: NeonGlowFrame,
  polaroid_frame: PolaroidFrame,
  rounded_frame: RoundedFrame,
};

interface DecorationRendererProps extends DecorationComponentProps {
  decorationId: string;
}

export const DecorationRenderer: React.FC<DecorationRendererProps> = ({
  decorationId,
  ...props
}) => {
  const Component = COMPONENT_MAP[decorationId];
  if (!Component) return null;
  return <Component {...props} />;
};
