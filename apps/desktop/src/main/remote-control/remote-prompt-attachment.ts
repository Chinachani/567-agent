import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { formatSshProjectUri, parseProjectLocation } from "@567agent/ssh-transport/project-uri";
import { resolveRemoteProjectPath } from "../filesystem/remote-filesystem.js";
import { getSshConnection } from "../ssh/ssh-runtime.js";

/** An attachment belongs to the session's execution filesystem, not its local metadata shadow. */
export async function storeRemotePromptFile(cwd: string, fileName: string, data: Buffer): Promise<string> {
	const safeName =
		fileName
			.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
			.trim()
			.slice(0, 180)
			.replace(/[. ]+$/, "") || "attachment";
	const name = `${randomUUID()}-${safeName}`;
	const location = parseProjectLocation(cwd);
	if (location.kind === "ssh") {
		const uri = formatSshProjectUri(
			location.hostId,
			posix.join(location.remotePath, ".567agent", "remote-attachments"),
		);
		const directory = parseProjectLocation(await resolveRemoteProjectPath(uri, true));
		if (directory.kind !== "ssh") throw new Error("Remote attachment directory is invalid");
		const connection = getSshConnection(directory.hostId);
		await connection.makeDirectory(directory.remotePath);
		const target = await resolveRemoteProjectPath(
			formatSshProjectUri(directory.hostId, posix.join(directory.remotePath, name)),
			true,
		);
		const destination = parseProjectLocation(target);
		if (destination.kind !== "ssh") throw new Error("Remote attachment path is invalid");
		if ((await connection.createEntry(destination.remotePath, "file")) !== "created")
			throw new Error("Attachment already exists");
		await connection.writeFile(destination.remotePath, data);
		return target;
	}
	const root = await realpath(cwd);
	const parent = join(root, ".567agent");
	await mkdir(parent, { recursive: true, mode: 0o700 });
	const parentInfo = await lstat(parent);
	if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
		throw new Error("Attachment directory cannot be a link");
	const directory = join(parent, "remote-attachments");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const directoryInfo = await lstat(directory);
	if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (await realpath(directory)) !== directory)
		throw new Error("Attachment directory escaped its workspace");
	const target = join(directory, name);
	await writeFile(target, data, { flag: "wx", mode: 0o600 });
	return target;
}
