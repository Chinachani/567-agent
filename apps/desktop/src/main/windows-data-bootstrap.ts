import { initializeWindowsDataEnvironment } from "./windows-data-environment.js";

// Must run before importing modules whose paths are bound during module evaluation.
if (process.platform === "win32") initializeWindowsDataEnvironment();
