import type { MotionLevel } from './types.ts';

export interface CameraInput {
  /** Absolute time in the video, seconds. */
  t: number;
  clipIndex: number;
  motion: MotionLevel;
}

/** Apply as `transform: scale(scale) translate(x%, y%)` on a full-frame image. */
export interface Camera {
  scale: number;
  x: number;
  y: number;
}

// Slow, constant-speed motion: a 6% zoom in/out and a gentle pan, with only short rounded turnarounds.
const ZOOM_MIN = 1.03;
const ZOOM_MAX = 1.09; // 6% range
const ZOOM_PERIOD_SEC = 30; // 15 s zooming in, 15 s zooming out, ≈0.4% per second
const PAN_X = 1.3; // % of frame; stays inside maxShift(ZOOM_MIN) so the pan is never clamped
const PAN_Y = 0.6;
const PAN_X_PERIOD_SEC = 50;
const PAN_Y_PERIOD_SEC = 64;
/** How sharp the turnarounds are: closer to 1 = longer constant-speed stretches, shorter turns (≈1–2 s). */
const TURN_SHARPNESS = 0.995;

/** Largest shift (% of frame) that keeps a zoomed image covering the whole frame. */
export function maxShift(scale: number): number {
  return scale <= 1 ? 0 : ((scale - 1) / (2 * scale)) * 100 * 0.95;
}

/**
 * Triangle wave in [-1, 1] with rounded peaks: moves at a near-constant speed and turns around smoothly,
 * so there is no visible stop or bounce.
 */
export function glide(t: number, period: number, phase = 0): number {
  return Math.asin(TURN_SHARPNESS * Math.sin((2 * Math.PI * t) / period + phase)) / Math.asin(TURN_SHARPNESS);
}

/** Camera for a scene image at time t: steady 6% zoom in/out and a steady slow pan. */
export function cameraAt({ t, clipIndex, motion }: CameraInput): Camera {
  if (motion === 'off') return { scale: 1, x: 0, y: 0 };
  const phase = clipIndex * 2.1; // consecutive scenes don't move in lockstep
  const scale = ZOOM_MIN + ((ZOOM_MAX - ZOOM_MIN) * (glide(t, ZOOM_PERIOD_SEC, phase) + 1)) / 2;
  const limit = maxShift(scale);
  const x = Math.max(-limit, Math.min(limit, PAN_X * glide(t, PAN_X_PERIOD_SEC, phase)));
  const y = Math.max(-limit, Math.min(limit, PAN_Y * glide(t, PAN_Y_PERIOD_SEC, phase * 1.3)));
  return { scale, x, y };
}
