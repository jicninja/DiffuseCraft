# Implementation Plan: Brush Settings UI

## Overview

Procreate-inspired brush settings controls for the Editor screen: vertical sidebar sliders (size + opacity), a color swatch indicator, and a floating color picker panel with HSB disc, hex input, and recent swatches. All code lives in `apps/mobile/src/screens/Editor/brush-settings/` plus updates to `index.tsx` and `LeftToolRail.tsx`. Components read/write `editorStore.brush` via `useEditorStore`. No new library code in `libs/`. No tests (deferred per `testing.md`).

## Tasks

- [x] 1. Create color utility functions (`color-utils.ts`)
  - Create `apps/mobile/src/screens/Editor/brush-settings/color-utils.ts`
  - Implement `HSBColor` interface (`h: 0–360`, `s: 0–1`, `b: 0–1`)
  - Implement `hsbToHex(hsb): string` — converts HSB to 6-char hex (no `#` prefix)
  - Implement `hexToHsb(hex): HSBColor` — converts 6-char hex to HSB
  - Implement `isValidHex(hex): boolean` — validates `/^[0-9A-Fa-f]{6}$/`
  - Implement `resolveColorToHex(color): string` — resolves `'token.*'` strings via token map, passes `'#...'` through, returns fallback `'#F4F4F5'` for unknown values (design §3.8)
  - Implement `clampValue(value, min, max): number`
  - _Requirements: 1.4, 2.4, 4.5, 6.2, 6.3_

- [x] 2. Create the recent colors hook (`use-recent-colors.ts`)
  - Create `apps/mobile/src/screens/Editor/brush-settings/use-recent-colors.ts`
  - Implement `useRecentColors()` hook returning `{ colors: readonly string[], pushColor: (hex: string) => void }`
  - `pushColor` deduplicates (case-insensitive), prepends to front, caps at 10 entries (design §3.9)
  - _Requirements: 5.2, 5.4, 5.5_

- [x] 3. Checkpoint — Type-check utilities
  - Run `nx typecheck mobile` and ensure `color-utils.ts` and `use-recent-colors.ts` compile cleanly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement VerticalSlider component
  - Create `apps/mobile/src/screens/Editor/brush-settings/VerticalSlider.tsx`
  - Implement `VerticalSliderProps` interface per design §3.1 (`value`, `onValueChange`, `min`, `max`, `step`, `trackHeight`, `renderPreview`, `accessibilityLabel`, `accessibilityStep`, `formatLabel`)
  - Build on `Gesture.Pan()` from `react-native-gesture-handler` + `react-native-reanimated` shared values for thumb position
  - Dragging up increases value, dragging down decreases value
  - Render vertical track with filled range indicator and animated thumb via `translateY`
  - Show floating value label near thumb during drag (fade in/out via Reanimated opacity)
  - Call `runOnJS(onValueChange)` on each gesture update for real-time store sync
  - Clamp output values using `clampValue` from `color-utils.ts`
  - Set `accessibilityRole="adjustable"` with `accessibilityValue={{ min, max, now: value }}`
  - Support VoiceOver increment/decrement via `accessibilityStep`
  - Ensure minimum 44pt touch target width
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 2.2, 2.3, 2.4, 2.5, 2.6, 8.3, 9.1, 9.2, 9.4_

- [x] 5. Implement BrushSidebarSliders component
  - Create `apps/mobile/src/screens/Editor/brush-settings/BrushSidebarSliders.tsx`
  - Implement `BrushSidebarSlidersProps` interface per design §3.2
  - Render two `VerticalSlider` instances stacked vertically
  - Size slider: reads `brush.size` from `useEditorStore`, writes via `setBrush({ size })`, `min=1`, `max=512`, `step=1`, label shows `"24 px"` format
  - Opacity slider: reads `brush.opacity` from `useEditorStore`, writes via `setBrush({ opacity })`, `min=0.01`, `max=1.0`, `step=0.01`, label shows `"85%"` format
  - Size slider `renderPreview`: circle whose diameter scales proportionally (capped ~40pt)
  - Opacity slider `renderPreview`: circle with fill opacity matching current value
  - Position absolutely at `left-[76px]`, vertically centered, with gap between sliders (design §3.2, D6)
  - Size slider: `accessibilityLabel` as brush size control, `accessibilityStep=1`
  - Opacity slider: `accessibilityLabel` as brush opacity control, `accessibilityStep=0.05` (5%)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.1, 8.2, 8.3, 9.1, 9.2, 9.4_

- [x] 6. Checkpoint — Type-check slider components
  - Run `nx typecheck mobile` and ensure `VerticalSlider.tsx` and `BrushSidebarSliders.tsx` compile cleanly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement ColorSwatch component
  - Create `apps/mobile/src/screens/Editor/brush-settings/ColorSwatch.tsx`
  - Implement `ColorSwatchProps` interface per design §3.3 (`onPress` callback)
  - Read `brush.color` from `useEditorStore`
  - Resolve color to display hex via `resolveColorToHex` from `color-utils.ts`
  - Render 36pt diameter circle filled with resolved color, 2pt `border-strong` ring
  - `accessibilityLabel="Brush color: #RRGGBB"` with dynamic hex value
  - `accessibilityRole="button"`
  - Minimum 44×44pt touch target (padding around 36pt circle)
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 7.2, 9.3_

- [x] 8. Implement HexColorInput component
  - Create `apps/mobile/src/screens/Editor/brush-settings/HexColorInput.tsx`
  - Implement `HexColorInputProps` interface per design §3.6 (`hex`, `onHexChange`, `error`)
  - Use `Input` from `@diffusecraft/ui` with non-editable `#` prefix as `Text` sibling
  - Validate on blur and on Enter: valid = 6 hex chars, calls `onHexChange`; invalid = red border (`border-danger-default`), retains previous color
  - Update input when color changes externally (disc drag, eyedropper, swatch tap)
  - `maxLength={6}`, `autoCapitalize="characters"`, `keyboardType="ascii-capable"`
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 9. Implement RecentColorSwatches component
  - Create `apps/mobile/src/screens/Editor/brush-settings/RecentColorSwatches.tsx`
  - Implement `RecentColorSwatchesProps` interface per design §3.7 (`colors`, `onSelect`)
  - Render up to 10 circular swatches (24pt diameter, 4pt gap) in a horizontal row
  - Each swatch is a `Pressable` with `accessibilityLabel="Recent color #RRGGBB"`
  - Active color (matching `brush.color`) gets a 2pt accent ring
  - Tapping calls `onSelect(hex)`
  - _Requirements: 5.1, 5.3_

- [x] 10. Checkpoint — Type-check color sub-components
  - Run `nx typecheck mobile` and ensure `ColorSwatch.tsx`, `HexColorInput.tsx`, and `RecentColorSwatches.tsx` compile cleanly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement ColorDisc component (Skia HSB wheel)
  - Create `apps/mobile/src/screens/Editor/brush-settings/ColorDisc.tsx`
  - Implement `ColorDiscProps` interface per design §3.5 (`hsb`, `onColorChange`)
  - Render Skia `Canvas` (~260×260pt) with:
    - Outer hue ring: `Circle` with `SweepGradient` cycling 0°–360°, ring width ~24pt, small circular indicator for current hue angle
    - Inner SV square: `Rect` inscribed within hue ring, horizontal gradient (white → full-saturation hue), vertical gradient (transparent → black), crosshair indicator for current S/B
  - Gesture handling via `Gesture.Pan()` on the Skia Canvas:
    - Distance from center within ring band → update hue based on angle
    - Within inner square → update saturation (x-axis) and brightness (y-axis)
    - Ignore touches in gap between ring and square
  - All position → color math in Reanimated worklets for zero-lag updates
  - `runOnJS(onColorChange)` on each gesture update
  - _Requirements: 4.2, 4.3, 4.4, 4.5_

- [x] 12. Implement ColorPickerPanel component
  - Create `apps/mobile/src/screens/Editor/brush-settings/ColorPickerPanel.tsx`
  - Implement `ColorPickerPanelProps` interface per design §3.4 (`visible`, `onClose`)
  - Layout top-to-bottom: drag handle bar → ColorDisc → HexColorInput → RecentColorSwatches
  - Absolute-positioned `View` with `bg-elevated`, `rounded-xl`, shadow, `z-50`
  - Initial position: centered horizontally, ~120pt from top
  - Draggable via `Gesture.Pan()` on entire panel, position in `useSharedValue`
  - Tap-outside-to-dismiss: overlay `Pressable` behind panel calls `onClose`
  - Accessibility escape gesture (two-finger Z-scrub) via `accessibilityEscape` callback
  - Panel size: ~300pt wide × ~420pt tall
  - Wire `useRecentColors` hook internally: push previous color to recents when user selects a new color via the disc
  - Read `brush.color` from `useEditorStore`, resolve to hex via `resolveColorToHex`, convert to HSB via `hexToHsb`
  - On color change from disc/hex/swatch: convert to hex, write `setBrush({ color: '#RRGGBB' })`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 7.3, 9.5_

- [x] 13. Checkpoint — Type-check color picker
  - Run `nx typecheck mobile` and ensure `ColorDisc.tsx` and `ColorPickerPanel.tsx` compile cleanly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Wire ColorSwatch into LeftToolRail
  - Update `apps/mobile/src/screens/Editor/LeftToolRail.tsx`
  - Import `ColorSwatch` from `./brush-settings/ColorSwatch`
  - Mount `ColorSwatch` above the brush preset buttons (top of the rail, before `BRUSH_TOOLS` map)
  - Pass `onPress` prop that triggers color picker panel open (via a callback prop or lifted state)
  - Add `onColorSwatchPress` to `LeftToolRailProps` interface for the parent to handle panel visibility
  - _Requirements: 3.1, 3.3_

- [x] 15. Wire BrushSidebarSliders and ColorPickerPanel into EditorScreen
  - Update `apps/mobile/src/screens/Editor/index.tsx`
  - Import `BrushSidebarSliders` from `./brush-settings/BrushSidebarSliders`
  - Import `ColorPickerPanel` from `./brush-settings/ColorPickerPanel`
  - Add `colorPickerVisible` state (boolean) to `EditorScreen`
  - Mount `BrushSidebarSliders` as a floating sibling alongside `LeftToolRail`
  - Mount `ColorPickerPanel` with `visible={colorPickerVisible}` and `onClose` toggling state
  - Pass `onColorSwatchPress` to `LeftToolRail` to set `colorPickerVisible=true`
  - Ensure correct z-ordering: `ColorPickerPanel` renders above sliders and canvas
  - _Requirements: 1.1, 2.1, 3.3, 4.1, 4.7_

- [x] 16. Final checkpoint — Full type-check and visual verification
  - Run `nx typecheck mobile` and ensure the entire `apps/mobile` project compiles cleanly
  - Verify no lint errors in new and modified files
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Testing is deferred per `.kiro/steering/testing.md` — no test tasks included
- Correctness properties (slider clamping, HSB↔hex round trip, recent colors invariants, invalid hex rejection) are documented in `design.md §5` for when testing resumes
- All code is TypeScript (React Native / Expo) — the project's standard language
- Each task references specific requirements for traceability
- Checkpoints use `nx typecheck mobile` as the verification mechanism
- Eyedropper integration (Req 7) is automatic: eyedropper writes to `brush.color` via `setBrush`, and all color UI components subscribe to `brush.color` via `useEditorStore` — no additional wiring needed (design §4.3)
