// @vitest-environment jsdom

import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendInputText, insertInputParts, prependPlainText, setInputEditor } from "./inputEditorHandle";
import { $createImageTokenNode, ImageTokenNode } from "./nodes";
import { $removeTriggerBeforeCaret } from "./tokens/trigger";

describe("insertInputParts", () => {
	afterEach(() => setInputEditor(null));

	it("inserts an ordered text-image sequence with one editor update", async () => {
		const editor = createEditor({
			namespace: "input-editor-test",
			nodes: [ImageTokenNode],
			onError: (error) => {
				throw error;
			},
		});
		editor.update(
			() => {
				const paragraph = $createParagraphNode();
				$getRoot().append(paragraph);
				paragraph.selectEnd();
			},
			{ discrete: true },
		);
		setInputEditor(editor);
		const update = vi.spyOn(editor, "update");
		const committed = new Promise<void>((resolve) => {
			const unregister = editor.registerUpdateListener(() => {
				unregister();
				resolve();
			});
		});

		insertInputParts([
			{ kind: "text", text: "before " },
			{ kind: "image", path: "C:/one.png" },
			{ kind: "text", text: "middle " },
			{ kind: "image", path: "C:/two.png" },
		]);
		await committed;

		expect(update).toHaveBeenCalledOnce();
		expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
			"before @C:/one.png middle @C:/two.png ",
		);
	});
});

describe("prependPlainText", () => {
	afterEach(() => setInputEditor(null));

	function editorWith(text?: string) {
		const editor = createEditor({
			namespace: "input-editor-prepend-test",
			nodes: [ImageTokenNode],
			onError: (error) => {
				throw error;
			},
		});
		editor.update(
			() => {
				const paragraph = $createParagraphNode();
				if (text !== undefined) paragraph.append($createTextNode(text));
				$getRoot().append(paragraph);
				// 光标停在末尾：用户刚打完字的真实状态。
				paragraph.selectEnd();
			},
			{ discrete: true },
		);
		setInputEditor(editor);
		return editor;
	}

	it("puts the text in front of what the user already typed", async () => {
		const editor = editorWith("深色主题");
		const committed = new Promise<void>((resolve) => {
			const unregister = editor.registerUpdateListener(() => {
				unregister();
				resolve();
			});
		});

		prependPlainText("帮我设计一个 App 界面：");
		await committed;

		// 光标当时在末尾，插入位置仍必须是开头——这正是它不能复用 insertPlainText 的原因。
		expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("帮我设计一个 App 界面：深色主题");
	});

	it("works on an empty draft", async () => {
		const editor = editorWith();
		const committed = new Promise<void>((resolve) => {
			const unregister = editor.registerUpdateListener(() => {
				unregister();
				resolve();
			});
		});

		prependPlainText("帮我设计一张海报：");
		await committed;

		expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("帮我设计一张海报：");
	});
});

describe("trigger replacement", () => {
	it.each(["已有描述/skill", "已有描述@research"])(
		"removes only the trailing trigger after existing text: %s",
		async (text) => {
			const editor = createEditor({
				namespace: "trigger-replacement-test",
				onError: (error) => {
					throw error;
				},
			});
			editor.update(
				() => {
					const paragraph = $createParagraphNode();
					paragraph.append($createTextNode(text));
					$getRoot().append(paragraph);
					paragraph.selectEnd();
				},
				{ discrete: true },
			);
			setInputEditor(editor);

			const committed = new Promise<void>((resolve) => {
				const unregister = editor.registerUpdateListener(() => {
					unregister();
					resolve();
				});
			});
			editor.update(() => $removeTriggerBeforeCaret());
			await committed;

			expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("已有描述");
			setInputEditor(null);
		},
	);
});

describe("append selected text", () => {
	afterEach(() => setInputEditor(null));
	it("retains the draft and real image tokens while appending a quotation", async () => {
		const editor = createEditor({
			namespace: "append-quote",
			nodes: [ImageTokenNode],
			onError: (error) => {
				throw error;
			},
		});
		editor.update(
			() => {
				const paragraph = $createParagraphNode();
				paragraph.append($createTextNode("Draft "), $createImageTokenNode("/tmp/kept.png"));
				$getRoot().append(paragraph);
				paragraph.selectStart();
			},
			{ discrete: true },
		);
		setInputEditor(editor);
		const committed = new Promise<void>((resolve) => {
			const off = editor.registerUpdateListener(() => {
				off();
				resolve();
			});
		});
		expect(appendInputText("quoted output")).toBe(true);
		await committed;
		const state = editor.getEditorState().toJSON();
		expect(JSON.stringify(state)).toContain('"type":"image-token"');
		expect(JSON.stringify(state)).toContain("/tmp/kept.png");
		expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toContain("Draft ");
		expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toMatch(/\n\nquoted output$/);
	});
});
