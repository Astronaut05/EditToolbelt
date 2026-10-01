/**
 * @etb/ui: the EditToolbelt design system, direction C "Signal"
 * (docs/03-design-system.md, docs/design/). Styles come from tokens.css and
 * theme.css; components use tokens only, never raw colours.
 */
export { cn } from './cn';

export { AppLink, type AppLinkProps } from './primitives/AppLink';
export { Breadcrumb, type Crumb } from './primitives/Breadcrumb';
export { Button, ButtonLink, type ButtonLinkProps, type ButtonProps } from './primitives/Button';
export { CopyButton } from './primitives/CopyButton';
export {
  ColorInput,
  FieldHint,
  Input,
  NumberWithUnit,
  Select,
  Slider,
  Switch,
} from './primitives/fields';
export { Kbd } from './primitives/Kbd';
export { MonoLabel } from './primitives/MonoLabel';
export { NumberedList } from './primitives/NumberedList';
export { OptionFact, OptionRow, OptionsPanel } from './primitives/OptionsPanel';
export { Dialog, Toast, Tooltip } from './primitives/overlays';
export { PresetPicker, type Preset } from './primitives/PresetPicker';
export { PrivacyBadge, type Noun } from './primitives/PrivacyBadge';
export { SegmentedControl, type SegmentOption } from './primitives/SegmentedControl';
export {
  CapabilityNotice,
  Card,
  CreditBadge,
  EmptyState,
  ErrorState,
  PriceConfirm,
  StatePanel,
} from './primitives/states';
export { StatusTag, Tag } from './primitives/Tag';
export { Tabs, type TabItem } from './primitives/Tabs';
export { THEME_STORAGE_KEY, themeScript, type ThemeChoice } from './primitives/theme';
export { ThemeToggle } from './primitives/ThemeToggle';
export { Wordmark } from './primitives/Wordmark';

export { Footer } from './layout/Footer';
export { ACCOUNT_PATH, Header, SIGN_IN_PATH } from './layout/Header';
export { MobileMenu, type NavItem } from './layout/MobileMenu';
export { OPEN_SEARCH_EVENT, SearchButton, SearchOverlay } from './layout/SearchOverlay';
export { loadSearchIndex, SEARCH_INDEX_URL, useGo, useSearch } from './layout/useSearch';

export { BatchList, type BatchItem } from './tool/BatchList';
export { BeforeAfter, MediaTag } from './tool/BeforeAfter';
export { CalculatorShell } from './tool/CalculatorShell';
export { CanvasEditor, type CanvasEditorProps, type EditorMode } from './tool/CanvasEditor';
export { NO_EDIT, type Edit } from './tool/crop';
export { CropFields } from './tool/CropFields';
export { DropZone, type DropZoneProps } from './tool/DropZone';
export { FactGrid, type GridFact } from './tool/FactGrid';
export { FactList, type ListFact } from './tool/FactList';
export {
  durationBucket,
  formatBytes,
  formatTimecode,
  matchesAccept,
  outputName,
  sizeBucket,
} from './tool/format';
export { ProgressBar, type ProgressMeta } from './tool/ProgressBar';
export { Readout, ReadoutRow, type Fact } from './tool/Readout';
export {
  ServerRunError,
  serverTerms,
  type ServerAccount,
  type ServerInfo,
  type ServerQuote,
  type ServerResult,
  type ServerRunContext,
  type ServerStage,
  type ShellServer,
} from './tool/server';
export { Timeline, type TimelineRange } from './tool/Timeline';
export { useEditor, type EditorState } from './tool/useEditor';
export {
  ToolShell,
  type InputInfo,
  type OutputInfo,
  type ProbeInfo,
  type ShellOption,
  type ShellPreset,
  type ShellState,
  type ShellTool,
  type ToolShellProps,
} from './tool/ToolShell';
