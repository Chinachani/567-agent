export function resolveBuildResourceFilters(families) {
	const filters = new Set(["pet/**/*"]);
	if (families.size > 0) {
		filters.add("tray-light.png");
		filters.add("tray-dark.png");
	}
	if (families.has("darwin")) {
		filters.add("trayTemplate.png");
		filters.add("trayTemplate@2x.png");
		filters.add("icon.icns");
		filters.add("icon.png");
		filters.add("icon-dock.png");
	}
	if (families.has("linux")) {
		filters.add("icon.png");
	}
	if (families.has("win32")) {
		filters.add("icon.ico");
		// file-transfer.ts 使用 PNG 作为可缩放的原生拖拽图标。
		filters.add("icon.png");
	}
	return [...filters];
}
