// JS color constants matching the CSS palette in src/styles/colors.css.
// Use these wherever CSS variables cannot reach (e.g. Mapbox GL paint properties).
//
// Five ramps × seven shades each; index 3 or 5 is the "core" shade per ramp
// (see product-specs/colors.md).

export const palette = {
  brandPrimary: {
    1: "#ACEE68",
    2: "#8CC354",
    3: "#6E9A41", // core
    4: "#51732E",
    5: "#364E1D",
    6: "#1D2C0D",
    7: "#0B1304",
  },
  brandSecondary: {
    1: "#DDF3E8",
    2: "#A8CEBC",
    3: "#87A697",
    4: "#677F74",
    5: "#495B52", // core
    6: "#2D3933",
    7: "#131A16",
  },
  info: {
    1: "#ECF1FA",
    2: "#C2D4F1",
    3: "#85AEE5", // core
    4: "#5589C4",
    5: "#3D6491",
    6: "#274261",
    7: "#122235",
  },
  surfaceCanvas: {
    1: "#D9D9B5",
    2: "#B1B193",
    3: "#8B8B73",
    4: "#676754",
    5: "#454538",
    6: "#25251D", // core
    7: "#11110C",
  },
  surfaceNeutral: {
    1: "#EBEFED",
    2: "#C1C7C5",
    3: "#9BA09E",
    4: "#777B79",
    5: "#545756",
    6: "#343636",
    7: "#171818",
  },
  white: "#FFFFFF",
  // Status — not part of the Figma palette; retained for state colors.
  success: "#00B56E",
  failure: "#FF4D32",
  warning: "#FF9F0A",
} as const;

// Semantic aliases — mirror the CSS `--color-*` tokens so consumers can pick
// by role instead of ramp+shade. Update both sides if you change the mapping.
export const colors = {
  accent:        palette.brandPrimary[3],
  accentDark:    palette.brandPrimary[5],
  secondary:     palette.brandSecondary[5],
  secondaryDark: palette.brandSecondary[6],
  info:          palette.info[3],
  infoDark:      palette.info[5],
  text:          palette.surfaceNeutral[7],
  bg:            palette.surfaceNeutral[1],
  surface:       palette.white,
  success:       palette.success,
  danger:        palette.failure,
  warning:       palette.warning,
} as const;
