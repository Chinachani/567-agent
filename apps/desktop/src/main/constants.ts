import { config } from "dotenv";
import { isCloudBuildEnabled } from "../shared/feature-flags.js";

// 仅在源码模式（bun run start，tsx 直跑 src/main/main.ts）下生效：
// 通过 dotenv 加载本地 .env 文件，让源码运行也能拿到 API567_BASE_URL。
// 构建产物（dist/main/index.js）里，process.env.API567_BASE_URL 已被 vite define
// 在构建期替换为字面量字符串，下面的 dotenv 调用对其无影响。
// dotenv 不会覆盖已存在的变量，先加载的优先级更高。
config({ path: ".env.development", quiet: true });
config({ path: ".env", quiet: true });

// lite 构建（AGENT567_CLOUD_ENABLED=false）不含云服务：NewAPI 网关、官方市场与
// 远程模型目录全部不进产物，因此不要求 NewAPI 地址。
// 完全体构建缺了它会在运行期一路失败到「Unknown provider」，必须尽早拦住。
const api567BaseUrl = process.env.API567_BASE_URL;
if (isCloudBuildEnabled() && !api567BaseUrl) {
	throw new Error("API567_BASE_URL 未配置。请检查 .env.<mode> 文件，或在打包时通过 AGENT567_BUILD_ENV 指定构建模式。");
}

export const DEFAULT_SERVER_URL: string = api567BaseUrl ?? "";
