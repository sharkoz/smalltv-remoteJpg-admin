import type { Clock } from '../util/time.js';
import { systemClock } from '../util/time.js';

interface CachedImage {
  jpg: Buffer;
  renderedAt: number;
}

/** Holds the latest rendered JPG per dashboard. The poll endpoint reads from here. */
export class ImageCache {
  private images = new Map<string, CachedImage>();

  constructor(private readonly clock: Clock = systemClock) {}

  get(dashboardId: string): CachedImage | undefined {
    return this.images.get(dashboardId);
  }

  has(dashboardId: string): boolean {
    return this.images.has(dashboardId);
  }

  set(dashboardId: string, jpg: Buffer): void {
    this.images.set(dashboardId, { jpg, renderedAt: this.clock.nowMs() });
  }

  invalidate(dashboardId: string): void {
    this.images.delete(dashboardId);
  }

  /** Age of a cached image in ms, or Infinity if absent. */
  ageMs(dashboardId: string): number {
    const img = this.images.get(dashboardId);
    return img ? this.clock.nowMs() - img.renderedAt : Number.POSITIVE_INFINITY;
  }
}
