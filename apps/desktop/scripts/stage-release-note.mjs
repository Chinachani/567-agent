import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Stage only the current version; callers own the fresh build directory. */
export function stageReleaseNote({ projectRoot, stageDir, version }) {
 if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error("Invalid release note version");
 const name = `v${version}.md`;
 const source = join(projectRoot, "..", "..", ".github", "release-notes", name);
 if (!existsSync(source)) throw new Error(`Release note missing: ${name}`);
 const destination = join(stageDir, "release-notes");
 mkdirSync(destination, { recursive: true });
 cpSync(source, join(destination, name));
}
