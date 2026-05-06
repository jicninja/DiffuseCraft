// Lucide icon wrapper with NativeWind `className` support via `cssInterop`.
//
// Source: react-native-reusables @ commit 7c287b976d461b717de397e1f581ab44c8e6d72d
// Path:   packages/registry/src/nativewind/components/ui/icon.tsx
// Repo:   https://github.com/founded-labs/react-native-reusables
// Pasted: 2026-05-03
//
// Pasted into `_internal/` because rnr ships `Icon` as a public component
// alongside `Text`, but DiffuseCraft only needs it as an implementation
// detail of `Checkbox` for now. When `Icon` becomes part of the public
// surface in a later spec it can be promoted to `components/Icon.tsx` with
// no behaviour change.

import type { LucideIcon, LucideProps } from 'lucide-react-native';
import { cssInterop } from 'nativewind';
import * as React from 'react';

import { TextClassContext, cn } from './utils';

type IconProps = LucideProps & {
  as: LucideIcon;
} & React.RefAttributes<LucideIcon>;

function IconImpl({ as: IconComponent, ...props }: IconProps) {
  return <IconComponent {...props} />;
}

cssInterop(IconImpl, {
  className: {
    target: 'style',
    nativeStyleToProp: {
      height: 'size',
      width: 'size',
    },
  },
});

export function Icon({ as: IconComponent, className, size = 14, ...props }: IconProps) {
  const textClass = React.useContext(TextClassContext);
  return (
    <IconImpl
      as={IconComponent}
      className={cn('text-foreground', textClass, className)}
      size={size}
      {...props}
    />
  );
}
