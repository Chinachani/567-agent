import { useThemeComponent } from "@vetta-org/theme-sdk";
import { InputBarView } from "./InputBarView";
import type { ControlledInputBarProps } from "./types";

export function InputBarPresentation({ model, children }: ControlledInputBarProps): JSX.Element {
	const ThemedInputBarView = useThemeComponent("chat.inputBarView", InputBarView);
	// Existing theme recipes predate children. Keep setup controls available even
	// when an override only consumes the original model contract.
	if (ThemedInputBarView !== InputBarView)
		return (
			<>
				{children}
				<ThemedInputBarView model={model} />
			</>
		);
	return <ThemedInputBarView model={model}>{children}</ThemedInputBarView>;
}
