/** Stable Coding Agent identity and configuration contract. */
export const PACKAGE_NAME = "@567agent/coding-agent";
export const APP_NAME = "567-agent";

// Project-local resources always use the branded directory. AGENT567_CONFIG_DIR only changes the home root.
export const CONFIG_DIR_NAME = ".567agent";
export const LEGACY_CONFIG_DIR_NAME = ".vetta";

export const ENV_AGENT_DIR = "AGENT567_CODING_AGENT_DIR";
export const ENV_PACKAGE_DIR = "AGENT567_PACKAGE_DIR";
export const ENV_SHARE_VIEWER_URL = "AGENT567_SHARE_VIEWER_URL";
export const ENV_API567_BASE_URL = "API567_BASE_URL";

/** Default server URL for remote provider/model configs. */
export const DEFAULT_SERVER_URL = "http://127.0.0.1:8080/api/v1";
