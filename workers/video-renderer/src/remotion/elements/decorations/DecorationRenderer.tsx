/**
 * DecorationRenderer — Maps decoration_id strings to their React components.
 * Worker version with .js import extensions.
 */
import React from 'react';
import type { DecorationComponentProps } from './types.js';

// Arrows
import { BouncingArrow } from './arrows/BouncingArrow.js';
import { CurvedArrow } from './arrows/CurvedArrow.js';
import { PointingHand } from './arrows/PointingHand.js';

// Badges
import { SubscribeBadge } from './badges/SubscribeBadge.js';
import { NewBadge } from './badges/NewBadge.js';
import { StarBurst } from './badges/StarBurst.js';
import { FireIcon } from './badges/FireIcon.js';
import { CheckmarkBadge } from './badges/CheckmarkBadge.js';

// Social
import { LikeHeart } from './social/LikeHeart.js';
import { ThumbsUp } from './social/ThumbsUp.js';
import { ShareIcon } from './social/ShareIcon.js';
import { CommentBubble } from './social/CommentBubble.js';
import { FollowerCount } from './social/FollowerCount.js';

// Emphasis
import { Sparkles } from './emphasis/Sparkles.js';
import { ExclamationMarks } from './emphasis/ExclamationMarks.js';
import { QuestionMarks } from './emphasis/QuestionMarks.js';
import { ZoomLines } from './emphasis/ZoomLines.js';
import { SpeedLines } from './emphasis/SpeedLines.js';

// Emojis
import { AnimatedEmoji } from './emojis/AnimatedEmoji.js';

// Frames
import { NeonGlowFrame } from './frames/NeonGlowFrame.js';
import { PolaroidFrame } from './frames/PolaroidFrame.js';
import { RoundedFrame } from './frames/RoundedFrame.js';

const COMPONENT_MAP: Record<string, React.FC<DecorationComponentProps>> = {
  bouncing_arrow: BouncingArrow,
  curved_arrow: CurvedArrow,
  pointing_hand: PointingHand,
  subscribe_badge: SubscribeBadge,
  new_badge: NewBadge,
  star_burst: StarBurst,
  fire_icon: FireIcon,
  checkmark_badge: CheckmarkBadge,
  like_heart: LikeHeart,
  thumbs_up: ThumbsUp,
  share_icon: ShareIcon,
  comment_bubble: CommentBubble,
  follower_count: FollowerCount,
  sparkles: Sparkles,
  exclamation_marks: ExclamationMarks,
  question_marks: QuestionMarks,
  zoom_lines: ZoomLines,
  speed_lines: SpeedLines,
  emoji_fire: (props) => <AnimatedEmoji {...props} config={{ emoji: '🔥', animation: 'bounce', ...props.config }} />,
  emoji_lightbulb: (props) => <AnimatedEmoji {...props} config={{ emoji: '💡', animation: 'pulse', ...props.config }} />,
  emoji_lightning: (props) => <AnimatedEmoji {...props} config={{ emoji: '⚡', animation: 'shake', ...props.config }} />,
  emoji_target: (props) => <AnimatedEmoji {...props} config={{ emoji: '🎯', animation: 'bounce', ...props.config }} />,
  emoji_money: (props) => <AnimatedEmoji {...props} config={{ emoji: '💰', animation: 'bounce', ...props.config }} />,
  emoji_rocket: (props) => <AnimatedEmoji {...props} config={{ emoji: '🚀', animation: 'float', ...props.config }} />,
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
