import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "happy-dom",
		environmentOptions: { happyDOM: { settings: { disableIframePageLoading: true } } },
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
	},
});
