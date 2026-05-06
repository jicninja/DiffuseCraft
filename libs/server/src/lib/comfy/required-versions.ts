/**
 * Pinned versions for managed-mode installs (A.2, FR-7, Q1).
 *
 * Per Q1: ComfyUI evolves rapidly; pinning by commit hash trades fewer free
 * upgrades for predictability. Every bump should be reviewed manually and
 * recorded in CHANGELOG with the tested matrix entry.
 *
 * Per Q4: each required custom node is also pinned by commit hash, not by
 * version range — a custom-node author publishing a breaking change cannot
 * silently break our managed installs.
 *
 * The values below are placeholders for v0.1 and SHALL be updated by the
 * release captain before the first managed-mode tag. They are intentionally
 * kept in TypeScript (rather than a YAML file) so the typecheck step ensures
 * any consumer that references them still builds.
 */

export interface PinnedVersions {
  /** Upstream ComfyUI repo URL. */
  readonly comfyui_repo: string;
  /**
   * Pinned ComfyUI commit hash. Defaults to the placeholder marker
   * `pending-release-captain` so that `installer.ts` refuses to clone until
   * a real hash is set (the placeholder is rejected at install time).
   */
  readonly comfyui_commit: string;
  /**
   * The minimum Python version we require on PATH for the managed venv
   * (Q3). Bundling Python is post-v1.
   */
  readonly python_min_version: readonly [number, number];
}

export const PINNED_VERSIONS: PinnedVersions = {
  comfyui_repo: 'https://github.com/comfyanonymous/ComfyUI.git',
  // Placeholder: the release captain replaces this with a real commit hash
  // before the first managed-mode tag. `installer.ts` rejects the placeholder
  // value to prevent accidental floating installs.
  comfyui_commit: 'pending-release-captain',
  python_min_version: [3, 10],
};

/**
 * `true` when the pinned commit is still the placeholder marker. `installer.ts`
 * uses this to refuse to run before the release captain has done their job.
 */
export function isPinnedCommitPlaceholder(): boolean {
  return PINNED_VERSIONS.comfyui_commit === 'pending-release-captain';
}
