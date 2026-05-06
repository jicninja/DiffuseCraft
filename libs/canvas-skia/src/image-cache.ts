/**
 * Image cache keyed by `content_blob_id` (E.3).
 *
 * The Skia adapter rasterizes a layer's bytes into an `SkImage` once and
 * caches the result so subsequent draw frames reuse the GPU resource. The
 * cache disposes evicted images explicitly to release native memory.
 */

import type { SkImage } from '@shopify/react-native-skia';

/** Pluggable byte loader. Apps inject a function that resolves blob bytes. */
export type BytesLoader = (blob_id: string) => Promise<Uint8Array | null>;

/** Pluggable image factory. The adapter passes Skia's `MakeImageFromEncoded`. */
export type ImageFactory = (bytes: Uint8Array) => SkImage | null;

export interface ImageCacheOptions {
  /** Maximum cache size (entry count). Oldest entries are evicted. */
  capacity?: number;
  loader: BytesLoader;
  factory: ImageFactory;
}

const DEFAULT_CAPACITY = 64;

/**
 * Simple LRU-by-insertion image cache. Synchronous lookup returns the live
 * image when warm; async load fetches + decodes when cold.
 */
export class LayerImageCache {
  private readonly map = new Map<string, SkImage>();
  private readonly capacity: number;
  private readonly loader: BytesLoader;
  private readonly factory: ImageFactory;
  private readonly inFlight = new Map<string, Promise<SkImage | null>>();

  constructor(opts: ImageCacheOptions) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.loader = opts.loader;
    this.factory = opts.factory;
  }

  /** Synchronous lookup. Returns null when cold. */
  peek(blob_id: string): SkImage | null {
    return this.map.get(blob_id) ?? null;
  }

  /**
   * Resolve an image, loading + decoding if needed. Concurrent calls for
   * the same `blob_id` share a single load promise.
   */
  async get(blob_id: string): Promise<SkImage | null> {
    const cached = this.map.get(blob_id);
    if (cached) return cached;
    const inFlight = this.inFlight.get(blob_id);
    if (inFlight) return inFlight;
    const promise = (async () => {
      const bytes = await this.loader(blob_id);
      if (!bytes) return null;
      const image = this.factory(bytes);
      if (image) this.set(blob_id, image);
      return image;
    })();
    this.inFlight.set(blob_id, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(blob_id);
    }
  }

  /** Insert with LRU eviction. */
  set(blob_id: string, image: SkImage): void {
    if (this.map.has(blob_id)) this.map.delete(blob_id);
    this.map.set(blob_id, image);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest !== undefined) {
        const oldImage = this.map.get(oldest);
        if (oldImage) oldImage.dispose();
        this.map.delete(oldest);
      }
    }
  }

  /** Evict and dispose every entry. */
  clear(): void {
    for (const img of this.map.values()) img.dispose();
    this.map.clear();
  }

  /** True when `blob_id` is loaded. */
  has(blob_id: string): boolean {
    return this.map.has(blob_id);
  }

  /** Number of cached entries. */
  size(): number {
    return this.map.size;
  }
}
