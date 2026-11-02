export const BROWSER_EXTENSION_RESOURCE: {
	from: "browser-extension";
	to: "browser-extension";
	filter: string[];
};

export function stageBrowserExtension(source: string, stage: string): Promise<string>;
