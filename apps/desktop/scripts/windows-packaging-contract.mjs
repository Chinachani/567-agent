export const WINDOWS_RELEASE_TARGETS = Object.freeze(["inno", "zip"]);

export const WINDOWS_SUPPLEMENTAL_EXTENSIONS = Object.freeze([".zip"]);

export function windowsSupplementalArtifactNames(version) {
	return WINDOWS_SUPPLEMENTAL_EXTENSIONS.map((extension) => `567-Agent-${version}-win-x64${extension}`);
}
