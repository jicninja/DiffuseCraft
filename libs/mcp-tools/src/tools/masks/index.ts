/**
 * Mask-system tools (mask-system spec §3.7).
 *
 * Seven write tools added to the v1 catalog:
 *
 *   - refine_mask         compose grow / shrink / feather / blur / threshold
 *   - invert_mask         flip alpha (or toggle from_layer.invert)
 *   - clear_mask          set all bytes to 0
 *   - fill_mask           set all bytes to a value
 *   - selection_to_mask   active selection → painted mask layer
 *   - mask_to_selection   painted mask → active selection
 *   - bake_mask           from_layer → painted (snapshot)
 *
 * All seven are reversible and emit `document.changed` on success.
 */
export { refineMask } from "./refine-mask";
export { invertMask } from "./invert-mask";
export { clearMask } from "./clear-mask";
export { fillMask } from "./fill-mask";
export { selectionToMask } from "./selection-to-mask";
export { maskToSelection } from "./mask-to-selection";
export { bakeMask } from "./bake-mask";
