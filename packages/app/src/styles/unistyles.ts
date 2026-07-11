import { StyleSheet } from "react-native-unistyles";
import {
  lightTheme,
  darkTheme,
  darkZincTheme,
  darkMidnightTheme,
  darkClaudeTheme,
  darkGhosttyTheme,
  darkBlackTheme,
  darkAuroraTheme,
  darkMeshTheme,
  darkDeepTheme,
  darkSweepTheme,
  darkEmberTheme,
} from "./theme";

StyleSheet.configure({
  themes: {
    light: lightTheme,
    dark: darkTheme,
    darkZinc: darkZincTheme,
    darkMidnight: darkMidnightTheme,
    darkClaude: darkClaudeTheme,
    darkGhostty: darkGhosttyTheme,
    darkBlack: darkBlackTheme,
    darkAurora: darkAuroraTheme,
    darkMesh: darkMeshTheme,
    darkDeep: darkDeepTheme,
    darkSweep: darkSweepTheme,
    darkEmber: darkEmberTheme,
  },
  breakpoints: {
    xs: 0,
    sm: 576,
    md: 768,
    lg: 992,
    xl: 1200,
  },
  settings: {
    adaptiveThemes: true,
  },
});

// Type augmentation for TypeScript
interface AppThemes {
  light: typeof lightTheme;
  dark: typeof darkTheme;
  darkZinc: typeof darkZincTheme;
  darkMidnight: typeof darkMidnightTheme;
  darkClaude: typeof darkClaudeTheme;
  darkGhostty: typeof darkGhosttyTheme;
  darkBlack: typeof darkBlackTheme;
  darkAurora: typeof darkAuroraTheme;
  darkMesh: typeof darkMeshTheme;
  darkDeep: typeof darkDeepTheme;
  darkSweep: typeof darkSweepTheme;
  darkEmber: typeof darkEmberTheme;
}

interface AppBreakpoints {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

declare module "react-native-unistyles" {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}
