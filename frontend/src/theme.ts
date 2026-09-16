import { createTheme, type MantineColorsTuple } from '@mantine/core';

/**
 * Astra — "Graphite" design language.
 * Neutral graphite surfaces; teal carries interaction, sand carries attention.
 * Colour never decorates — it only marks an action, a status, or a source.
 */

const teal: MantineColorsTuple = [
  '#E8F8FA', // 0  tint bg (light mode light-variant fill)
  '#D0F0F4', // 1
  '#A2E2EA', // 2
  '#71D3DF', // 3
  '#4CC5D4', // 4
  '#35BCCC', // 5
  '#2BB6C4', // 6  PRIMARY — filled buttons, focus ring, active nav rail
  '#1C9FAC', // 7  hover on filled
  '#0F7885', // 8  light-mode primary (AA on white)
  '#005E6A', // 9  light-mode text-on-tint
];

const sand: MantineColorsTuple = [
  '#FDF6E7',
  '#FAECCF',
  '#F5D9A0',
  '#F2C879', // 3  ACCENT — dark-mode running/pinned/source accent
  '#EAB758',
  '#E0A93F',
  '#D89B2C', // 6
  '#B67D1C',
  '#8F6112', // 8  light-mode accent text (AA on white)
  '#6B4708',
];

/** Neutral graphite. Replaces Mantine's blue-tinted `dark` scale wholesale. */
const graphite: MantineColorsTuple = [
  '#E7EAEE', // 0  primary text (dark mode)
  '#C6CCD4', // 1  secondary text / body copy
  '#98A1AB', // 2  dimmed text — 4.6:1 on dark[9], never go lighter-weight than this
  '#6C747E', // 3  disabled text, icon-only idle
  '#4A5159', // 4  hover border
  '#343A41', // 5  divider inside a surface
  '#272C34', // 6  BORDER — every panel edge
  '#171B20', // 7  SURFACE — inputs, default buttons, cards, code blocks
  '#13161A', // 8  CHROME — header, navbar, panel headers
  '#0E1013', // 9  BODY — app background, scroll areas
];

const green: MantineColorsTuple = [
  '#E6F6F0','#C8EBE0','#97D9C4','#65C6A8','#4CB795',
  '#3FA987','#3A9D7D','#2F8267','#256A53','#174A39',
];

const red: MantineColorsTuple = [
  '#FDECEE','#F9D3D8','#F1A7B1','#EA7E8C','#E2707F',
  '#D85B6C','#C9495A','#AE3848','#8F2938','#6B1B27',
];

export const theme = createTheme({
  colors: { teal, sand, graphite, green, red, dark: graphite },
  primaryColor: 'teal',
  primaryShade: { light: 8, dark: 6 },

  white: '#FFFFFF',
  black: '#101418',

  defaultRadius: 'sm', // 6px — the app's only corner, except pills
  radius: { xs: '3px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },

  fontFamily: "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
  headings: {
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '24px', lineHeight: '1.25' },
      h2: { fontSize: '19px', lineHeight: '1.3' },
      h3: { fontSize: '16px', lineHeight: '1.35' },
      h4: { fontSize: '14px', lineHeight: '1.4' },
    },
  },
  fontSizes: { xs: '11px', sm: '12px', md: '14px', lg: '16px', xl: '19px' },
  lineHeights: { xs: '1.4', sm: '1.5', md: '1.6', lg: '1.65', xl: '1.7' },
  spacing: { xs: '6px', sm: '8px', md: '12px', lg: '16px', xl: '24px' },

  // Borders do the work; shadows are reserved for overlays only.
  shadows: {
    xs: 'none',
    sm: 'none',
    md: '0 8px 24px rgba(0,0,0,.45)',
    lg: '0 16px 40px rgba(0,0,0,.55)',
    xl: '0 24px 64px rgba(0,0,0,.6)',
  },

  cursorType: 'pointer',
  focusRing: 'auto',

  components: {
    Button: {
      defaultProps: { size: 'sm', radius: 'sm', fw: 600 },
      styles: { root: { height: 32, paddingInline: 14, fontSize: 13 } },
    },
    ActionIcon: {
      defaultProps: { variant: 'default', size: 32, radius: 'sm' },
    },
    TextInput:  { defaultProps: { size: 'sm', radius: 'sm' } },
    Textarea:   { defaultProps: { size: 'sm', radius: 'sm', autosize: true, minRows: 2, maxRows: 10 } },
    Select:     { defaultProps: { size: 'sm', radius: 'sm', checkIconPosition: 'right' } },
    MultiSelect:{ defaultProps: { size: 'sm', radius: 'sm' } },
    Input: {
      styles: { input: { height: 34, minHeight: 34, fontSize: 13 } },
    },
    InputWrapper: {
      styles: { label: { fontSize: 12, fontWeight: 500, marginBottom: 4 } },
    },
    Badge: {
      defaultProps: { variant: 'light', radius: 'xl', size: 'sm' },
      styles: {
        root: {
          height: 20,
          paddingInline: 8,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          fontWeight: 500,
          textTransform: 'none',
          letterSpacing: '0.02em',
        },
      },
    },
    Card: {
      defaultProps: { radius: 'sm', padding: 'md', withBorder: true, shadow: undefined },
    },
    Paper: {
      defaultProps: { radius: 'sm', withBorder: true, shadow: undefined },
    },
    Table: {
      defaultProps: { horizontalSpacing: 10, verticalSpacing: 9, highlightOnHover: true, withRowBorders: true },
      styles: {
        th: {
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10.5,
          fontWeight: 500,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        },
        td: { fontSize: 13 },
      },
    },
    Tabs: { defaultProps: { variant: 'default', keepMounted: false } },
    Modal: {
      defaultProps: { radius: 'md', centered: true, overlayProps: { backgroundOpacity: 0.6, blur: 2 } },
      styles: { title: { fontSize: 16, fontWeight: 600 } },
    },
    Drawer:  { defaultProps: { radius: 0, position: 'right', size: 480 } },
    Tooltip: { defaultProps: { radius: 'sm', withArrow: false, openDelay: 300, fz: 12 } },
    Menu:    { defaultProps: { radius: 'sm', shadow: 'md', withinPortal: true } },
    Notification: { defaultProps: { radius: 'sm', withBorder: true } },
    Code: {
      styles: {
        root: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, borderRadius: 3 },
      },
    },
    ScrollArea: { defaultProps: { scrollbarSize: 8, type: 'hover' } },
    Divider:    { defaultProps: { color: 'var(--astra-border)' } },
    Loader:     { defaultProps: { type: 'dots', size: 'sm' } },
    Anchor:     { defaultProps: { underline: 'hover' } },
  },

  other: {
    /** Layout constants the app relies on — read these, don't re-type the numbers. */
    headerHeight: 56,
    navbarWidth: 240,
    sessionListWidth: 352,
    sessionRowHeight: 64,
    panelHeaderHeight: 48,
    controlHeight: 32,
    inputHeight: 34,
  },
});
