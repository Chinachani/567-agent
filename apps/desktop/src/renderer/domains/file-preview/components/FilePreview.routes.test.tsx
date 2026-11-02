// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { PluginPreviewFile } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pluginFilePreviewsAtom } from "@shared/store/atoms";
import { FilePreviewView } from "./FilePreviewView";
import { FilePreviewDialogView } from "./FilePreviewDialogView";
import { TextPreviewRenderer } from "./TextPreviewRenderer";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@shared/i18n", () => ({ i18n: { t: (key: string) => key } }));

const readFile = vi.fn(async () => ({ content: "ZmlsZSBieXRlcw==", encoding: "base64" }));
const saveCopy = vi.fn(async () => null);
beforeEach(() => {
	readFile.mockClear();
	saveCopy.mockClear();
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: {
			fs: {
				readFile,
				readTextPreviewFile: async () => ({ status: "binary", size: 2 }),
				watchDir: async () => {},
				unwatchDir: async () => {},
				onDirChanged: () => () => {},
			},
			dialog: { saveCopy },
		},
	});
});
afterEach(cleanup);

function RegisteredPreview({ file }: { file: PluginPreviewFile }) {
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
		void file.readBytes().then(() => setLoaded(true));
	}, [file]);
	return <p>{loaded ? `${file.extension}: ${file.name}` : "loading file"}</p>;
}

it.each(["pdf", "docx", "pptx", "xlsx", "csv", "png", "svg", "mp3", "mp4"])(
	"routes %s to its registered renderer in both workbench and file dialog",
	async (extension) => {
		const item = { name: `REPORT.${extension.toUpperCase()}`, path: `/work/report.${extension}` };
		const ctx = { items: [item], index: 0 };
		const store = createStore();
		store.set(pluginFilePreviewsAtom, [
			{ pluginId: "document-viewer", extensions: [extension], component: RegisteredPreview },
		]);
		const view = render(
			<Provider store={store}>
				<FilePreviewView ctx={ctx} onClose={() => {}} canPrev={false} canNext={false} />
			</Provider>,
		);
		await screen.findByText(`${extension}: ${item.name}`);
		expect(readFile).toHaveBeenCalledWith(item.path);
		view.unmount();
		render(
			<Provider store={store}>
				<FilePreviewDialogView
					item={item}
					context={ctx}
					isImageGroup={false}
					labels={{ close: "close", download: "download", showInFolder: "show" }}
					onClose={() => {}}
					onDownload={() => {}}
					onGoNext={() => {}}
					onGoPrev={() => {}}
					onSelectIndex={() => {}}
					onShowInFolder={() => {}}
				/>
			</Provider>,
		);
		if (extension === "png") {
			expect(await screen.findByRole("img", { name: item.name })).toBeTruthy();
		} else {
			await screen.findByText(`${extension}: ${item.name}`);
		}
	},
);

it("keeps an unsupported local document recoverable from the workbench preview", async () => {
	const user = userEvent.setup();
	render(
		<Provider store={createStore()}>
			<FilePreviewView
				ctx={{ items: [{ name: "old.doc", path: "/work/old.doc" }], index: 0 }}
				onClose={() => {}}
				canPrev={false}
				canNext={false}
			/>
		</Provider>,
	);
	await screen.findByText("fileEditor.unsupported");
	await user.click(screen.getByRole("button", { name: "fileEditor.download" }));
	expect(saveCopy).toHaveBeenCalledWith("/work/old.doc", { defaultFileName: "old.doc" });
});

it("renders the declared markdown extension as Markdown", async () => {
	render(
		<Provider store={createStore()}>
			<TextPreviewRenderer content="# Visible document heading" extension="markdown" />
		</Provider>,
	);
	expect(await screen.findByRole("heading", { name: "Visible document heading" })).toBeTruthy();
});
