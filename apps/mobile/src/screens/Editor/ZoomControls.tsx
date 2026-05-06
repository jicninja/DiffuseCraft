/**
 * ZoomControls — floating zoom control overlay for the Editor canvas.
 *
 * Extracted from `CanvasPlaceholder.tsx`. Renders a compact Card pinned to
 * the top-right of the canvas area with zoom-out, zoom percentage / reset,
 * zoom-in, and fit-to-view buttons.
 *
 * All viewport mutations are delegated to the parent via callback props
 * (wired to `useViewport` in `CanvasArea`).
 *
 * Requirements: FR-39, FR-40, FR-41, FR-42
 */

import { Maximize, Minus, Plus } from 'lucide-react-native';
import { Text } from 'react-native';

import { Button, Card } from '@diffusecraft/ui';

import { EDITOR_STRINGS } from '../_strings/Editor';

export interface ZoomControlsProps {
  /** Current zoom level (1 = 100%). */
  zoom: number;
  /** FR-39: Zoom in by a fixed step (×1.25). */
  onZoomIn: () => void;
  /** FR-40: Zoom out by a fixed step (÷1.25). */
  onZoomOut: () => void;
  /** FR-41: Reset viewport to identity (100%, no pan, no rotation). */
  onReset: () => void;
  /** FR-42: Fit the document within the available canvas area with padding. */
  onFitToView: () => void;
}

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFitToView,
}: ZoomControlsProps) {
  const zoomPercent = `${Math.round(zoom * 100)}%`;

  return (
    <Card
      className="absolute right-3 top-3 flex-row items-center gap-1 rounded-md border border-border-subtle bg-elevated/90 p-1"
      accessibilityLabel={EDITOR_STRINGS.canvas.zoomA11yLabel}
    >
      <Button
        variant="ghost"
        size="icon"
        accessibilityLabel="Zoom out"
        className="h-7 w-7"
        onPress={onZoomOut}
      >
        <Minus size={16} className="text-text-primary" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        accessibilityLabel={EDITOR_STRINGS.canvas.zoomActual}
        className="h-7 px-2"
        onPress={onReset}
      >
        <Text className="text-caption text-text-primary">{zoomPercent}</Text>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        accessibilityLabel="Zoom in"
        className="h-7 w-7"
        onPress={onZoomIn}
      >
        <Plus size={16} className="text-text-primary" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        accessibilityLabel={EDITOR_STRINGS.canvas.zoomFit}
        className="h-7 w-7"
        onPress={onFitToView}
      >
        <Maximize size={14} className="text-text-primary" />
      </Button>
    </Card>
  );
}

ZoomControls.displayName = 'ZoomControls';
