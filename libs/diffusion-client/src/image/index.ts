/**
 * Image envelope helpers (H.1 + H.2, design.md §2 / §11, requirements
 * §3.11 FR-34 / FR-35).
 *
 * Re-exported as a single namespace so the eventual
 * `DiffuseCraftClient.image` field (Phase B.6) can wire both helpers in
 * one import.
 */

export { fetchImage } from "./fetch";
export { uploadImage, type UploadImageOptions } from "./upload";
