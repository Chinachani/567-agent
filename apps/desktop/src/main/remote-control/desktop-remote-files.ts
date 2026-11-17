import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isSshProjectUri } from "@567agent/ssh-transport/project-uri";
import { nativeImage } from "electron";
import { openPreviewSource, readFilesystemDirectory } from "../filesystem/filesystem-service.js";
import { resolveRemoteProjectPath } from "../filesystem/remote-filesystem.js";
import { RemoteFiles } from "./remote-files.js";

/** Uses the desktop preview boundary, including its registered SSH project roots. */
export function createDesktopRemoteFiles(): RemoteFiles {
	return new RemoteFiles({
		home: homedir(),
		path,
		fs: {
			readDirectory: readFilesystemDirectory,
			openSource: openPreviewSource,
			realpath: (target) => (isSshProjectUri(target) ? resolveRemoteProjectPath(target) : realpath(target)),
			scaleImage: (bytes) => {
				const image = nativeImage.createFromBuffer(bytes);
				if (image.isEmpty()) return undefined;
				const { width, height } = image.getSize();
				if (width <= 1600 && height <= 1600) return undefined;
				return image.resize(width >= height ? { width: 1600 } : { height: 1600 }).toJPEG(85);
			},
		},
	});
}
