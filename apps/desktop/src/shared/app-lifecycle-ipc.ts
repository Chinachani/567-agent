export const APP_LIFECYCLE_RENDERER_BOOT_PAINTED_CHANNEL = "vetta:app-lifecycle:renderer-boot-painted";
export const APP_LIFECYCLE_RENDERER_CONTENT_PAINTED_CHANNEL = "vetta:app-lifecycle:renderer-content-painted";
export const APP_LIFECYCLE_WHEN_READY_CHANNEL = "vetta:app-lifecycle:when-ready";
export const APP_LIFECYCLE_DESIGN_SHARE_OPEN_CHANNEL = "vetta:app-lifecycle:design-share-open";

export interface DesignShareOpenEvent {
	filePath: string;
}

export function isDesignSharePath(filePath: string): boolean {
	return /\.567design$/i.test(filePath);
}

export function findDesignSharePath(argv: readonly string[]): string | undefined {
	return argv.find(isDesignSharePath);
}
