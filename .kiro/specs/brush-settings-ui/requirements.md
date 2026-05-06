# Requirements Document

## Introduction

Procreate-inspired brush settings UI for the DiffuseCraft Editor screen. The editor already has brush presets selectable via the LeftToolRail and brush state managed in `editorStore.brush` (size, hardness, opacity, color, pressureCurve), but there is no UI for the user to directly view or adjust color, size, or opacity. This spec adds three Procreate-style controls: a color picker (color disc/wheel), a sidebar size slider, and a sidebar opacity slider — all tablet-first, touch-friendly, and minimal-chrome per the project's Procreate inspiration (P22, `inspirations.md` §Procreate).

All changes live in `apps/mobile/` only. No new library code in `libs/`. Testing is deferred per `testing.md`.

### Dependencies

- **Editor store brush slice** — `libs/core/src/stores/editor/brush-slice.ts` (`editorStore.brush`, `setBrush`)
- **Brush presets** — `libs/canvas-core/src/brush/presets.ts` (5 fixed presets: pen, pencil, marker, eraser, smooth)
- **LeftToolRail** — `apps/mobile/src/screens/Editor/LeftToolRail.tsx` (switches presets, calls `setBrush`)
- **Editor screen** — `apps/mobile/src/screens/Editor/index.tsx` (assembles floating UI clusters)
- **Theme tokens** — `libs/ui/src/theme/tokens.ts` (dark theme colors, radii, spacing)
- **@diffusecraft/ui** — component library (Slider, Popover, etc.)
- **Eyedropper gesture** — already wired in `useGestureCompositor.ts` (long-press = eyedropper per `inspirations.md`)

## Glossary

- **Editor_Screen**: The main editor view (`apps/mobile/src/screens/Editor/index.tsx`) that assembles the canvas and all floating UI clusters.
- **Brush_Slice**: The Zustand slice in `editorStore` that holds `size`, `hardness`, `opacity`, `color`, and `pressureCurve` fields (`libs/core/src/stores/editor/brush-slice.ts`).
- **Color_Disc**: A circular HSB color picker inspired by Procreate's color wheel — an outer hue ring with an inner saturation/brightness triangle or square.
- **Color_Picker_Panel**: A floating panel (not full-screen modal) containing the Color_Disc, brightness/saturation controls, and quick swatches. Inspired by Procreate's color picker.
- **Size_Slider**: A vertical sidebar slider on the left edge of the editor for adjusting brush size, inspired by Procreate's sidebar slider.
- **Opacity_Slider**: A vertical sidebar slider on the left edge of the editor (below the Size_Slider) for adjusting brush opacity, inspired by Procreate's sidebar slider.
- **Color_Swatch**: A small circular indicator showing the current brush color. Tapping it opens the Color_Picker_Panel.
- **LeftToolRail**: The existing floating vertical tool rail on the left edge of the editor that holds brush presets and tool buttons.
- **Active_Brush_Color**: The resolved hex color value for the current brush, derived from the `color` field in Brush_Slice.

## Requirements

### Requirement 1: Brush Size Sidebar Slider

**User Story:** As an illustrator, I want a vertical slider on the left edge of the editor to adjust brush size by dragging up/down, so that I can change brush size without opening a menu or leaving the canvas.

#### Acceptance Criteria

1. THE Size_Slider SHALL render as a vertical slider positioned on the left edge of the Editor_Screen, adjacent to or integrated with the LeftToolRail.
2. WHEN the user drags the Size_Slider thumb up, THE Size_Slider SHALL increase the `size` value in Brush_Slice.
3. WHEN the user drags the Size_Slider thumb down, THE Size_Slider SHALL decrease the `size` value in Brush_Slice.
4. THE Size_Slider SHALL constrain the `size` value to a range of 1 to 512 pixels.
5. WHEN the user adjusts the Size_Slider, THE Size_Slider SHALL display the current numeric size value as a label near the slider thumb.
6. THE Size_Slider SHALL have a minimum touch target of 44pt width to satisfy tablet touch-friendliness.
7. WHEN the active tool is `eraser`, THE Size_Slider SHALL control the eraser size using the same Brush_Slice `size` field.

### Requirement 2: Brush Opacity Sidebar Slider

**User Story:** As an illustrator, I want a vertical slider on the left edge of the editor to adjust brush opacity by dragging up/down, so that I can control stroke transparency without navigating away from the canvas.

#### Acceptance Criteria

1. THE Opacity_Slider SHALL render as a vertical slider positioned on the left edge of the Editor_Screen, below the Size_Slider.
2. WHEN the user drags the Opacity_Slider thumb up, THE Opacity_Slider SHALL increase the `opacity` value in Brush_Slice.
3. WHEN the user drags the Opacity_Slider thumb down, THE Opacity_Slider SHALL decrease the `opacity` value in Brush_Slice.
4. THE Opacity_Slider SHALL constrain the `opacity` value to a range of 0.01 to 1.0 (1% to 100%).
5. WHEN the user adjusts the Opacity_Slider, THE Opacity_Slider SHALL display the current opacity as a percentage label near the slider thumb.
6. THE Opacity_Slider SHALL have a minimum touch target of 44pt width to satisfy tablet touch-friendliness.

### Requirement 3: Color Swatch Indicator

**User Story:** As an illustrator, I want to see the current brush color at a glance on the editor, so that I know which color is active without opening any panel.

#### Acceptance Criteria

1. THE Color_Swatch SHALL render as a circular indicator positioned near the top of the LeftToolRail or at a fixed position on the Editor_Screen.
2. THE Color_Swatch SHALL display the Active_Brush_Color as a filled circle.
3. WHEN the user taps the Color_Swatch, THE Editor_Screen SHALL open the Color_Picker_Panel.
4. WHEN the `color` value in Brush_Slice changes, THE Color_Swatch SHALL update its displayed color within the same render frame.
5. THE Color_Swatch SHALL have a minimum touch target of 44×44pt.

### Requirement 4: Color Picker Panel (Color Disc)

**User Story:** As an illustrator, I want a Procreate-style color disc to pick colors by touch, so that I can select hues, saturation, and brightness intuitively on a tablet.

#### Acceptance Criteria

1. THE Color_Picker_Panel SHALL render as a floating panel overlaying the Editor_Screen, not as a full-screen modal.
2. THE Color_Picker_Panel SHALL contain a Color_Disc with an outer hue ring and an inner saturation/brightness selector.
3. WHEN the user drags along the outer hue ring of the Color_Disc, THE Color_Picker_Panel SHALL update the hue component of the Active_Brush_Color in real time.
4. WHEN the user drags within the inner saturation/brightness area of the Color_Disc, THE Color_Picker_Panel SHALL update the saturation and brightness components of the Active_Brush_Color in real time.
5. WHEN the user selects a color via the Color_Disc, THE Color_Picker_Panel SHALL write the selected color to the `color` field in Brush_Slice.
6. THE Color_Picker_Panel SHALL display the current color as a hex value that the user can read.
7. WHEN the user taps outside the Color_Picker_Panel, THE Color_Picker_Panel SHALL dismiss itself.
8. THE Color_Picker_Panel SHALL be draggable so the user can reposition it to avoid occluding the canvas.

### Requirement 5: Quick Color Swatches

**User Story:** As an illustrator, I want a row of recently used colors in the color picker, so that I can quickly switch back to colors I have already used.

#### Acceptance Criteria

1. THE Color_Picker_Panel SHALL display a row of recent color swatches below the Color_Disc.
2. THE Color_Picker_Panel SHALL store up to 10 recently used colors, ordered most-recent-first.
3. WHEN the user taps a recent color swatch, THE Color_Picker_Panel SHALL set the `color` field in Brush_Slice to the tapped color.
4. WHEN the user selects a new color via the Color_Disc, THE Color_Picker_Panel SHALL add the previously active color to the recent swatches list.
5. WHEN the recent swatches list exceeds 10 entries, THE Color_Picker_Panel SHALL remove the oldest entry.

### Requirement 6: Hex Color Input

**User Story:** As an illustrator, I want to type a specific hex color code into the color picker, so that I can use exact brand colors or values shared by collaborators.

#### Acceptance Criteria

1. THE Color_Picker_Panel SHALL include a text input field that accepts hex color codes in `#RRGGBB` format.
2. WHEN the user enters a valid 6-digit hex code, THE Color_Picker_Panel SHALL update the Color_Disc position and the `color` field in Brush_Slice to match the entered value.
3. IF the user enters an invalid hex code, THEN THE Color_Picker_Panel SHALL retain the previous color and display a visual error indicator on the input field.
4. WHEN the Active_Brush_Color changes via the Color_Disc, THE hex input field SHALL update to reflect the new hex value.

### Requirement 7: Eyedropper Integration

**User Story:** As an illustrator, I want the color picked by the eyedropper gesture to update the brush color and reflect in the color picker, so that the eyedropper and color picker stay in sync.

#### Acceptance Criteria

1. WHEN the eyedropper tool picks a color from the canvas, THE Brush_Slice `color` field SHALL update to the picked color.
2. WHEN the Brush_Slice `color` field is updated by the eyedropper, THE Color_Swatch SHALL reflect the new color.
3. WHEN the Color_Picker_Panel is open and the Brush_Slice `color` field is updated by the eyedropper, THE Color_Disc position and hex input SHALL update to reflect the new color.

### Requirement 8: Slider Visual Feedback

**User Story:** As an illustrator, I want the size and opacity sliders to show a visual preview of the current brush setting, so that I can understand the effect of my adjustment before painting.

#### Acceptance Criteria

1. THE Size_Slider SHALL display a circular preview indicator near the slider thumb whose diameter scales proportionally to the current `size` value.
2. THE Opacity_Slider SHALL display a preview indicator near the slider thumb whose fill opacity matches the current `opacity` value.
3. WHILE the user is dragging either slider, THE corresponding preview indicator SHALL update in real time with no perceptible lag.

### Requirement 9: Accessibility

**User Story:** As a user relying on assistive technology, I want the brush settings controls to be accessible, so that I can adjust brush properties using VoiceOver or TalkBack.

#### Acceptance Criteria

1. THE Size_Slider SHALL expose an `accessibilityRole` of `adjustable` and an `accessibilityLabel` describing it as the brush size control.
2. THE Opacity_Slider SHALL expose an `accessibilityRole` of `adjustable` and an `accessibilityLabel` describing it as the brush opacity control.
3. THE Color_Swatch SHALL expose an `accessibilityLabel` that includes the current color name or hex value.
4. WHEN the user increments or decrements a slider via assistive technology, THE slider SHALL adjust the value by a step of 1 pixel for size and 5% for opacity.
5. THE Color_Picker_Panel SHALL be dismissible via the accessibility escape gesture (two-finger Z-scrub on iOS).

## Out of Scope

- **Custom brush engine** — v1 uses 5 fixed presets; custom brush tips, dynamics, and dual-brush are post-v1 per `product.md`.
- **Hardness control UI** — hardness is part of Brush_Slice but is preset-driven in v1; no user-facing slider.
- **Pressure curve editor UI** — pressure curves are preset-driven in v1; no user-facing editor.
- **HSL/RGB/CMYK alternate color modes** — v1 ships with HSB disc only; additional modes are post-v1.
- **Palette management** (save/load/name palettes) — post-v1.
- **Color harmony modes** (complementary, analogous, triadic) — Procreate has these but they are post-v1.
- **Phone-specific layout** — phone is a degraded fallback (P22); tablet layout is the reference.
- **Tests** — deferred per `testing.md`.
- **New library code in `libs/`** — all changes are in `apps/mobile/` only.
