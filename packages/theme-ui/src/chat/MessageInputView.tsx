import { useThemeSurface } from "@vetta-org/theme-sdk/appearance";
import { cn } from "@vetta-org/ui";
import { Slot } from "radix-ui";
import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { createContext, forwardRef, useContext } from "react";
import { ThemeSurface } from "../appearance/ThemeSurface";
import type { SessionDropZoneViewProps } from "./SessionDropZoneView";
import { SessionDropZoneView } from "./SessionDropZoneView";

interface MessageInputContextValue {
	readonly focused: boolean;
	readonly topConnected: boolean;
}

const MessageInputContext = createContext<MessageInputContextValue | null>(null);

export interface MessageInputRootProps {
	readonly focused: boolean;
	readonly topConnected?: boolean;
	readonly children: ReactNode;
}

export interface MessageInputPrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

export type MessageInputDropZoneProps = SessionDropZoneViewProps;

/** Owns controlled message-input state; layout and abilities remain explicit children. */
export function MessageInputRoot({ focused, topConnected = false, children }: MessageInputRootProps): JSX.Element {
	return <MessageInputContext.Provider value={{ focused, topConnected }}>{children}</MessageInputContext.Provider>;
}

/**
 * Visual input surface. `asChild` merges the surface contract into another primitive,
 * allowing DropZone to own the same DOM box without introducing a wrapper.
 */
export const MessageInputSurface = forwardRef<HTMLDivElement, MessageInputPrimitiveProps>(function MessageInputSurface(
	{ asChild = false, children, className, ...props },
	forwardedRef,
) {
	const { focused, topConnected } = useMessageInputContext("Surface");
	const Comp = asChild ? Slot.Root : "div";
	const surfaceClassName = cn(
		"input-card relative z-10 overflow-visible border bg-input-bar-bg transition-[border-color,background-color] duration-200",
		topConnected ? "rounded-b-2xl rounded-t-none" : "rounded-2xl",
		focused ? "border-ring/50 ring-1 ring-inset ring-ring/20" : "border-border",
		className,
	);

	return (
		<Comp
			ref={forwardedRef}
			className={surfaceClassName}
			data-focused={focused ? "" : undefined}
			data-top-connected={topConnected ? "" : undefined}
			{...props}
		>
			<ThemeSurface slot="chat.inputBar" />
			{asChild ? <Slot.Slottable>{children}</Slot.Slottable> : children}
		</Comp>
	);
});

/** Optional drag-and-drop behavior primitive, composed into Surface with `asChild`. */
export function MessageInputDropZone(props: MessageInputDropZoneProps): JSX.Element {
	return <SessionDropZoneView {...props} />;
}

/** Stacking and radius boundary for caller-selected input abilities. */
export const MessageInputContent = forwardRef<HTMLDivElement, MessageInputPrimitiveProps>(function MessageInputContent(
	{ asChild = false, className, ...props },
	forwardedRef,
) {
	const Comp = asChild ? Slot.Root : "div";
	return <Comp ref={forwardedRef} className={cn("relative z-10 rounded-[inherit]", className)} {...props} />;
});

export const MessageInputToolbar = forwardRef<HTMLDivElement, MessageInputPrimitiveProps>(function MessageInputToolbar(
	{ asChild = false, children, className, ...props },
	forwardedRef,
) {
	const Comp = asChild ? Slot.Root : "div";
	return (
		<Comp
			ref={forwardedRef}
			className={cn("flex flex-nowrap items-center justify-between gap-x-1.5 px-2 pb-2.5 pt-2 sm:px-3", className)}
			data-message-input-part="toolbar"
			{...props}
		>
			{children}
		</Comp>
	);
});

export const MessageInputToolbarLeading = forwardRef<HTMLDivElement, MessageInputPrimitiveProps>(
	function MessageInputToolbarLeading({ asChild = false, children, className, ...props }, forwardedRef) {
		const surface = useThemeSurface("chat.inputBarToolbarLeft");
		const Comp = asChild ? Slot.Root : "div";
		return (
			<Comp
				ref={forwardedRef}
				className={cn("flex min-w-0 shrink items-center gap-0.5", surface?.rootClassName, className)}
				data-message-input-part="toolbar-leading"
				data-theme-surface-root="chat.inputBarToolbarLeft"
				{...props}
			>
				{children}
			</Comp>
		);
	},
);

export const MessageInputToolbarTrailing = forwardRef<HTMLDivElement, MessageInputPrimitiveProps>(
	function MessageInputToolbarTrailing({ asChild = false, children, className, ...props }, forwardedRef) {
		const surface = useThemeSurface("chat.inputBarToolbarRight");
		const Comp = asChild ? Slot.Root : "div";
		return (
			<Comp
				ref={forwardedRef}
				className={cn("ml-auto flex min-w-0 shrink items-center gap-1", surface?.rootClassName, className)}
				data-message-input-part="toolbar-trailing"
				data-theme-surface-root="chat.inputBarToolbarRight"
				{...props}
			>
				{children}
			</Comp>
		);
	},
);

function useMessageInputContext(part: string): MessageInputContextValue {
	const context = useContext(MessageInputContext);
	if (!context) {
		throw new Error(`MessageInput.${part} must be used within MessageInput.Root`);
	}
	return context;
}

/** Compound primitives for structurally composing a message input. */
export const MessageInput = {
	Root: MessageInputRoot,
	Surface: MessageInputSurface,
	DropZone: MessageInputDropZone,
	Content: MessageInputContent,
	Toolbar: MessageInputToolbar,
	ToolbarLeading: MessageInputToolbarLeading,
	ToolbarTrailing: MessageInputToolbarTrailing,
} as const;
