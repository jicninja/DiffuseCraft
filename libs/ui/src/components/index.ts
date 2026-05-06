// Public barrel for @diffusecraft/ui components.
//
// One named re-export line per component file. Tree-shaking-friendly:
// no `export * from './all'` aggregator file (per requirements.md NFR-1).
//
// Groups land independently and append their exports. Maintain alphabetical
// order within each group section. Do NOT remove or reorder another group's
// section without coordination.

// Group 1 — Forms & inputs
export { Button, buttonTextVariants, buttonVariants } from './Button';
export type { ButtonProps } from './Button';
export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';
export { Input } from './Input';
export type { InputProps } from './Input';
export { Label } from './Label';
export type { LabelProps } from './Label';
export { RadioGroup, RadioGroupItem } from './RadioGroup';
export type { RadioGroupItemProps, RadioGroupProps } from './RadioGroup';
export { Slider } from './Slider';
export type { SliderProps } from './Slider';
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';
export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';

// Group 2 — Layout & meta
export { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './Accordion';
export type { AccordionProps } from './Accordion';
export { Avatar, AvatarFallback, AvatarImage } from './Avatar';
export type { AvatarProps } from './Avatar';
export { Badge, badgeTextVariants, badgeVariants } from './Badge';
export type { BadgeProps } from './Badge';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './Card';
export type { CardProps } from './Card';
export { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';
export type { CollapsibleProps } from './Collapsible';
export { Separator } from './Separator';
export type { SeparatorProps } from './Separator';
export { Skeleton } from './Skeleton';
export type { SkeletonProps } from './Skeleton';
export { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';
export type { TabsProps } from './Tabs';

// Group 3 — Overlays
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './AlertDialog';
export type { AlertDialogContentProps, AlertDialogProps } from './AlertDialog';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './Dialog';
export type { DialogContentProps, DialogProps } from './Dialog';
export { Popover, PopoverContent, PopoverTrigger } from './Popover';
export type { PopoverContentProps, PopoverProps } from './Popover';
export {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from './Sheet';
export type {
  SheetContentProps,
  SheetDescriptionProps,
  SheetFooterProps,
  SheetHeaderProps,
  SheetProps,
  SheetTitleProps,
} from './Sheet';
export { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';
export type { TooltipContentProps, TooltipProps } from './Tooltip';

// Group 4 — Pickers + Feedback
export { Combobox } from './Combobox';
export type { ComboboxOption, ComboboxProps } from './Combobox';
export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './ContextMenu';
export type {
  ContextMenuContentProps,
  ContextMenuItemProps,
  ContextMenuProps,
  ContextMenuTriggerProps,
} from './ContextMenu';
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './DropdownMenu';
export type {
  DropdownMenuContentProps,
  DropdownMenuItemProps,
  DropdownMenuProps,
  DropdownMenuTriggerProps,
} from './DropdownMenu';
export { Progress } from './Progress';
export type { ProgressProps } from './Progress';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './Select';
export type {
  Option as SelectOption,
  SelectContentProps,
  SelectGroupProps,
  SelectItemProps,
  SelectLabelProps,
  SelectProps,
  SelectSeparatorProps,
  SelectTriggerProps,
  SelectValueProps,
} from './Select';
export { Toast, ToastProvider, toast } from './Toast';
export type {
  ToastIntent,
  ToastOptions,
  ToastProps,
  ToastProviderProps,
} from './Toast';
