import { z } from "zod";

const reason = z.enum([
	"windows_api_unavailable",
	"x11_display_unavailable",
	"x11_libraries_unavailable",
	"x11_open_display_failed",
	"accessibility_permission_required",
	"capture_source_read_only",
	"capture_source_not_selected",
	"unsupported_platform",
]);

export const captureInputStateSchema = z.object({
	supported: z.boolean(),
	granted: z.boolean(),
	pointerMode: z.enum(["absolute", "relative"]),
	reason: reason.optional(),
});
export type CaptureInputState = z.infer<typeof captureInputStateSchema>;

export const captureInitializationSchema = z.object({
	signalingTargets: z.array(z.string().min(1).max(16_384)).min(1).max(8),
	appRoot: z.string().min(1).max(4096),
	isPackaged: z.boolean(),
	devServerUrl: z.string().max(4096).optional(),
	autoShareScreen: z.boolean(),
	language: z.enum(["zh", "en"]),
	input: captureInputStateSchema,
});

export const captureTargetSchema = z
	.object({
		x: z.number().finite(),
		y: z.number().finite(),
		width: z.number().positive().finite(),
		height: z.number().positive().finite(),
	})
	.nullable();

export const captureCapabilitySchema = z.object({ supported: z.boolean(), reason: reason.optional() });

// Only the native prompts used by the capture window may cross the private channel.
export const captureDialogSchema = z.object({
	type: z.enum(["question", "warning"]),
	title: z.string().max(1024),
	message: z.string().max(4096),
	detail: z.string().max(4096).optional(),
	checkboxLabel: z.string().max(1024).optional(),
	checkboxChecked: z.boolean().optional(),
	buttons: z.array(z.string().max(1024)).min(1).max(128),
	defaultId: z.number().int().nonnegative().optional(),
	cancelId: z.number().int().nonnegative().optional(),
});
export const captureDialogResultSchema = z.object({
	response: z.number().int().nonnegative(),
	checkboxChecked: z.boolean(),
});
