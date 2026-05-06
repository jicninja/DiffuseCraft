// Sheet — custom DiffuseCraft wrapper over `@gorhom/bottom-sheet`.
//
// NOT pasted from react-native-reusables. Exposes an rnr-style
// `<Sheet open onOpenChange>` API so screen authors consume bottom
// sheets the same way they consume `Dialog` / `AlertDialog` /
// `Popover`. See `.kiro/specs/ui-component-library/design.md` §7.1.
//
// Background, handle, and shadow read tokens through `useTheme()` per
// design.md §4.3 — `@gorhom/bottom-sheet`'s `backgroundStyle` /
// `handleStyle` / `handleIndicatorStyle` accept `ViewStyle`, not
// `className`, so NativeWind classes alone are insufficient.
//
// `<PortalProvider>` is mounted by the `app-shell-navigation` spec
// inside `App.tsx`; this wrapper does NOT mount it.

import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import * as React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useTheme } from '../theme';
import { cn } from './_internal/utils';

const DEFAULT_SNAP_POINTS: Array<string | number> = ['25%', '50%', '90%'];

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapPoints?: Array<string | number>;
  children: React.ReactNode;
}

function Sheet({
  open,
  onOpenChange,
  snapPoints = DEFAULT_SNAP_POINTS,
  children,
}: SheetProps) {
  const theme = useTheme();
  const ref = React.useRef<BottomSheet>(null);

  // Sync the controlled `open` prop with the imperative bottom-sheet API.
  // - `open=true` snaps to index 0 (the smallest snap point).
  // - `open=false` closes the sheet.
  React.useEffect(() => {
    if (open) {
      ref.current?.snapToIndex(0);
    } else {
      ref.current?.close();
    }
  }, [open]);

  const handleSheetChange = React.useCallback(
    (index: number) => {
      // index === -1 means the sheet has fully closed; mirror that into
      // the controlled prop so parent state stays consistent.
      if (index === -1 && open) {
        onOpenChange(false);
      }
    },
    [open, onOpenChange]
  );

  const renderBackdrop = React.useCallback(
    (backdropProps: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...backdropProps}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={1}
        style={[backdropProps.style, styles.backdrop]}
      />
    ),
    []
  );

  const backgroundStyle: ViewStyle = {
    backgroundColor: theme.color['bg.elevated'],
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
  };

  const handleStyle: ViewStyle = {
    backgroundColor: theme.color['bg.elevated'],
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
  };

  const handleIndicatorStyle: ViewStyle = {
    backgroundColor: theme.color['border.strong'],
  };

  // Reanimated `boxShadow.sheet` token is rendered as RN style. iOS reads
  // shadowOffset/Color/Opacity/Radius; Android reads `elevation`. We map
  // the design token to both shapes so both platforms render the lift.
  const sheetShadow = theme.elevation.sheet;
  const containerStyle: ViewStyle = {
    shadowOffset: { width: sheetShadow.offsetX, height: sheetShadow.offsetY },
    shadowColor: sheetShadow.color,
    shadowOpacity: 1,
    shadowRadius: sheetShadow.blur,
    elevation: 12,
  };

  return (
    <BottomSheet
      ref={ref}
      index={open ? 0 : -1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={backgroundStyle}
      handleStyle={handleStyle}
      handleIndicatorStyle={handleIndicatorStyle}
      style={containerStyle}
    >
      {children}
    </BottomSheet>
  );
}
Sheet.displayName = 'Sheet';

export interface SheetContentProps {
  children: React.ReactNode;
  className?: string;
}

function SheetContent({ children, className }: SheetContentProps) {
  return (
    <BottomSheetView className={cn('flex-1 bg-popover px-4 pb-6 pt-2', className)}>
      {children}
    </BottomSheetView>
  );
}
SheetContent.displayName = 'SheetContent';

export interface SheetHeaderProps {
  children: React.ReactNode;
}

function SheetHeader({ children }: SheetHeaderProps) {
  return <View className="flex flex-col gap-2 pb-4">{children}</View>;
}
SheetHeader.displayName = 'SheetHeader';

export interface SheetTitleProps {
  children: React.ReactNode;
}

function SheetTitle({ children }: SheetTitleProps) {
  return <Text className="text-foreground text-lg font-semibold">{children}</Text>;
}
SheetTitle.displayName = 'SheetTitle';

export interface SheetDescriptionProps {
  children: React.ReactNode;
}

function SheetDescription({ children }: SheetDescriptionProps) {
  return <Text className="text-muted-foreground text-sm">{children}</Text>;
}
SheetDescription.displayName = 'SheetDescription';

export interface SheetFooterProps {
  children: React.ReactNode;
}

function SheetFooter({ children }: SheetFooterProps) {
  return (
    <View className="flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end">{children}</View>
  );
}
SheetFooter.displayName = 'SheetFooter';

const styles = StyleSheet.create({
  // The backdrop scrim colour is sourced from the `scrim` Tailwind alias
  // (defined in tailwind.config.js → colors.scrim = rgba(0,0,0,0.6)). We
  // can't apply that via NativeWind because @gorhom/bottom-sheet's
  // BottomSheetBackdrop accepts only ViewStyle; literal alpha black is
  // mirrored here to stay in sync with the token.
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});

export { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle };
