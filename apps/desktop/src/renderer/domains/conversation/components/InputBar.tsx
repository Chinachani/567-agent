import { useStore } from "jotai";
import { useLayoutEffect, useRef } from "react";
import { activeComposerCommandsAtom } from "@shared/store/atoms";
import { focusInputEditor } from "./input-bar/editor/inputEditorHandle";
import { InputBarPresentation } from "./input-bar/InputBarPresentation";
import type { InputBarProps } from "./input-bar/types";

export function InputBar({ model, children }: InputBarProps): JSX.Element {
	const store = useStore();
	const latest = useRef(model);
	latest.current = model;
	useLayoutEffect(() => {
		const commands = {
			focus: () => {
				focusInputEditor();
			},
			isBusy: () => latest.current.isStreaming,
			abort: () => {
				if (latest.current.isStreaming) void latest.current.actions.handleAbort();
			},
		};
		store.set(activeComposerCommandsAtom, commands);
		return () => {
			if (store.get(activeComposerCommandsAtom) === commands) store.set(activeComposerCommandsAtom, null);
		};
	}, [store]);
	return <InputBarPresentation model={model}>{children}</InputBarPresentation>;
}

export type { InputBarProps };
