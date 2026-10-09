import { createDesktopProjectService } from "./desktop-project-service.js";

/** Reuse one import project per local calendar day. */
export async function ensureMobileImportProject(now = new Date()): Promise<{ path: string }> {
	const date = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, "0"),
		String(now.getDate()).padStart(2, "0"),
	].join("-");
	const name = `手机导入 ${date}`;
	return createDesktopProjectService().create(name);
}
