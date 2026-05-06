// Toast — non-modal notification wrapper over `sonner-native`.
//
// Custom (NOT a react-native-reusables paste). Surfaces:
//   - <ToastProvider> — re-export of sonner-native's <Toaster /> for app-root
//     mount. The app-shell-navigation spec mounts this near <ThemeProvider>.
//   - toast.show({ title, description, intent?, duration?, action? }) —
//     imperative entry point matching the rnr-style declarative shape.
//   - toast.success / .warn / .danger / .info / .error / .dismiss — thin
//     pass-throughs to sonner-native's typed helpers.
//
// Spec reference: ui-component-library design.md §7.2 + §10 Q4 (both
// declarative and imperative are required).
// Date: 2026-05-03.

import * as React from 'react';
import { Toaster, toast as sonnerToast } from 'sonner-native';

// sonner-native does not export ExternalToast as a public type; mirror its
// shape locally so the wrapper API stays typed without the upstream import.
type SonnerExternalToast = Parameters<typeof sonnerToast>[1];

export type ToastIntent = 'default' | 'neutral' | 'success' | 'warn' | 'danger' | 'destructive' | 'info';

export interface ToastOptions {
  title: string;
  description?: string;
  /** Default `'default'`. `'destructive'` is an alias for `'danger'`. */
  intent?: ToastIntent;
  /** Duration in ms; sonner-native's default is 4000. */
  duration?: number;
  action?: { label: string; onPress: () => void };
}

/**
 * Mount once at the app root (next to `<ThemeProvider>`). Re-exports
 * sonner-native's `<Toaster />` so screen authors do not learn the
 * sonner-native API directly.
 */
export const ToastProvider = Toaster;
export type ToastProviderProps = React.ComponentProps<typeof Toaster>;

function buildSonnerOptions({
  description,
  duration,
  action,
}: Pick<ToastOptions, 'description' | 'duration' | 'action'>): SonnerExternalToast {
  const opts: SonnerExternalToast = {};
  if (description !== undefined) opts.description = description;
  if (duration !== undefined) opts.duration = duration;
  if (action) {
    opts.action = {
      label: action.label,
      onClick: action.onPress,
    };
  }
  return opts;
}

function show(options: ToastOptions): string | number {
  const { title, intent = 'default' } = options;
  const sonnerOpts = buildSonnerOptions(options);

  switch (intent) {
    case 'success':
      return sonnerToast.success(title, sonnerOpts);
    case 'warn':
      return sonnerToast.warning(title, sonnerOpts);
    case 'danger':
    case 'destructive':
      return sonnerToast.error(title, sonnerOpts);
    case 'info':
      return sonnerToast.info(title, sonnerOpts);
    case 'default':
    case 'neutral':
    default:
      return sonnerToast(title, sonnerOpts);
  }
}

/**
 * Imperative toast API. Mirrors the sonner-native shape so screen authors
 * can call `toast.show({...})` (rnr-style) or one of the typed helpers.
 */
export const toast = {
  show,
  success: (msg: string, opts?: Omit<ToastOptions, 'title' | 'intent'>) =>
    sonnerToast.success(msg, opts ? buildSonnerOptions(opts) : undefined),
  warn: (msg: string, opts?: Omit<ToastOptions, 'title' | 'intent'>) =>
    sonnerToast.warning(msg, opts ? buildSonnerOptions(opts) : undefined),
  danger: (msg: string, opts?: Omit<ToastOptions, 'title' | 'intent'>) =>
    sonnerToast.error(msg, opts ? buildSonnerOptions(opts) : undefined),
  /** Alias for `danger` matching sonner-native's vocabulary. */
  error: (msg: string, opts?: Omit<ToastOptions, 'title' | 'intent'>) =>
    sonnerToast.error(msg, opts ? buildSonnerOptions(opts) : undefined),
  info: (msg: string, opts?: Omit<ToastOptions, 'title' | 'intent'>) =>
    sonnerToast.info(msg, opts ? buildSonnerOptions(opts) : undefined),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
} as const;

/**
 * `Toast` namespace export: covers the contract test in
 * `componentsCoverage.test.ts` which expects `Toast.show` to be a function
 * AND treats `<Toast>` itself as the renderable counterpart (it forwards
 * to `<ToastProvider>`).
 */
export const Toast = Object.assign(
  function Toast(props: ToastProviderProps) {
    return <ToastProvider {...props} />;
  },
  {
    show: toast.show,
    success: toast.success,
    warn: toast.warn,
    danger: toast.danger,
    error: toast.error,
    info: toast.info,
    dismiss: toast.dismiss,
  },
);
(Toast as unknown as { displayName?: string }).displayName = 'Toast';

export type ToastProps = ToastProviderProps;
