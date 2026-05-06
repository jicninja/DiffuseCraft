/**
 * Ambient type stubs for `@shopify/react-native-skia`.
 *
 * The real types live in the published package. We declare a structural
 * subset here so `canvas-skia` can typecheck inside the workspace without
 * installing the runtime dependency. When apps that consume `canvas-skia`
 * install `@shopify/react-native-skia`, its actual types take precedence
 * during their typecheck because their tsconfig resolves the package's
 * own `types` field first.
 *
 * Keep this file aligned with the structural shape of the API we use.
 */

declare module '@shopify/react-native-skia' {
  import type { ComponentType, ReactNode, RefObject } from 'react';
  import type { ViewStyle } from 'react-native';

  /** Surface ref forwarded by `<Canvas>`. */
  export interface SkSurface {
    getCanvas(): SkCanvas;
    makeImageSnapshot(): SkImage;
    flush(): void;
    dispose(): void;
  }

  /** Native canvas API (subset). */
  export interface SkCanvas {
    save(): number;
    restore(): void;
    translate(dx: number, dy: number): void;
    scale(sx: number, sy: number): void;
    rotate(deg: number, px?: number, py?: number): void;
    drawImage(image: SkImage, x: number, y: number, paint?: SkPaint): void;
    drawRect(rect: SkRect, paint: SkPaint): void;
    drawPath(path: SkPath, paint: SkPaint): void;
    drawCircle(cx: number, cy: number, radius: number, paint: SkPaint): void;
    drawPicture(picture: SkPicture): void;
    clear(color: number): void;
    saveLayer(paint?: SkPaint): number;
  }

  /** Recorded GPU command list — produced by `Skia.PictureRecorder`. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface SkPicture {}

  /** Recorder used to build an `SkPicture` for the active stroke. */
  export interface SkPictureRecorder {
    beginRecording(bounds: SkRect): SkCanvas;
    finishRecordingAsPicture(): SkPicture;
  }

  export interface SkImage {
    width(): number;
    height(): number;
    encodeToBytes(): Uint8Array;
    dispose(): void;
  }

  export interface SkPaint {
    setAlphaf(alpha: number): void;
    setColor(color: number): void;
    setBlendMode(mode: SkBlendMode): void;
    setStrokeWidth(width: number): void;
    setAntiAlias(antiAlias: boolean): void;
    setShader(shader: SkShader | null): void;
  }

  export interface SkPath {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    quadTo(x1: number, y1: number, x2: number, y2: number): void;
    close(): void;
  }

  export interface SkRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  /** Subset of Skia blend mode enum we use. Real values come from native. */
  export type SkBlendMode =
    | 'Clear'
    | 'Src'
    | 'Dst'
    | 'SrcOver'
    | 'DstOver'
    | 'SrcIn'
    | 'DstIn'
    | 'SrcOut'
    | 'DstOut'
    | 'SrcATop'
    | 'DstATop'
    | 'Xor'
    | 'Plus'
    | 'Modulate'
    | 'Screen'
    | 'Overlay'
    | 'Darken'
    | 'Lighten'
    | 'ColorDodge'
    | 'ColorBurn'
    | 'HardLight'
    | 'SoftLight'
    | 'Difference'
    | 'Exclusion'
    | 'Multiply'
    | 'Hue'
    | 'Saturation'
    | 'Color'
    | 'Luminosity';

  /**
   * Skia BlendMode constant — exposed both as a value (numeric enum-like
   * lookup) and as a type alias so callers can use `BlendMode.SrcOver` and
   * declare `blendMode: BlendMode` interchangeably.
   */
  export const BlendMode: Readonly<Record<SkBlendMode, SkBlendMode>>;
  export type BlendMode = SkBlendMode;

  /** Skia shader handle. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface SkShader {}

  /** Skia color as Float32Array [r, g, b, a] in 0..1. */
  export type SkColor = Float32Array;

  /** Point with x/y coordinates. */
  export interface SkPoint {
    x: number;
    y: number;
  }

  /** Tile mode for gradient shaders. */
  export enum TileMode {
    Clamp = 0,
    Repeat = 1,
    Mirror = 2,
    Decal = 3,
  }

  /** Skia entry point. */
  export const Skia: {
    Paint(): SkPaint;
    Path: {
      Make(): SkPath;
    };
    Surface: {
      MakeOffscreen(width: number, height: number): SkSurface | null;
    };
    PictureRecorder(): SkPictureRecorder;
    XYWHRect(x: number, y: number, w: number, h: number): SkRect;
    Image: {
      MakeImageFromEncoded(bytes: Uint8Array): SkImage | null;
    };
    Color(color: string): number;
    Shader: {
      MakeRadialGradient(
        center: SkPoint,
        radius: number,
        colors: SkColor[],
        pos: number[] | null,
        mode: TileMode,
      ): SkShader;
    };
  };

  /** React component that mounts a native Skia surface. */
  export interface CanvasProps {
    style?: ViewStyle;
    children?: ReactNode;
    onLayout?: (event: { nativeEvent: { layout: { width: number; height: number } } }) => void;
    ref?: RefObject<SkSurface>;
  }
  export const Canvas: ComponentType<CanvasProps>;

  /** Declarative Image component for displaying SkImage in the Canvas tree. */
  export interface ImageProps {
    image: SkImage | null;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    fit?: string;
  }
  export const Image: ComponentType<ImageProps>;

  /** Declarative Fill component — fills the canvas with a solid color. */
  export interface FillProps {
    color?: string | number;
    opacity?: number;
    children?: ReactNode;
  }
  export const Fill: ComponentType<FillProps>;

  /** Declarative Rect component — draws a rectangle. */
  export interface RectProps {
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string | number;
    children?: ReactNode;
  }
  export const Rect: ComponentType<RectProps>;

  /** Declarative Circle component — draws a circle. */
  export interface CircleProps {
    cx: number;
    cy: number;
    r: number;
    color?: string | number;
    opacity?: number;
    children?: ReactNode;
  }
  export const Circle: ComponentType<CircleProps>;

  /** Transform object for Group. */
  export type SkTransform =
    | { translateX: number }
    | { translateY: number }
    | { scale: number }
    | { scaleX: number }
    | { scaleY: number }
    | { rotate: number }
    | { rotateZ: number };

  /** Declarative Group component — applies transforms and clips to children. */
  export interface GroupProps {
    transform?: SkTransform[];
    opacity?: number;
    children?: ReactNode;
    clip?: unknown;
    invertClip?: boolean;
  }
  export const Group: ComponentType<GroupProps>;

  /** Declarative Picture component — replays a recorded SkPicture. */
  export interface PictureProps {
    picture: SkPicture | { value: SkPicture | null } | unknown;
    x?: number;
    y?: number;
    children?: ReactNode;
  }
  export const Picture: ComponentType<PictureProps>;

  /** Hook returning a ref to the underlying surface. */
  export function useCanvasRef(): RefObject<SkSurface>;

  /** Pressure-aware touch event from RN Skia gesture-handler integration. */
  export interface SkiaTouch {
    x: number;
    y: number;
    /** 0..1 stylus pressure (Apple Pencil / S-Pen). */
    force?: number;
    /** Tilt vector in degrees. */
    tiltX?: number;
    tiltY?: number;
    /** Pointer kind ("pen" | "touch" | "mouse"). */
    type?: string;
    timestamp?: number;
  }
}
