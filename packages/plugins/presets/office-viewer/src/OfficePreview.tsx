import { type PluginFilePreviewProps, useTranslation } from "@vetta-org/plugin-sdk";
import { lazy, Suspense, useEffect, useState, type JSX } from "react";
import { ErrorState, LoadingState } from "./components/PreviewState";
import { isSpreadsheetExtension } from "./office-formats";

// Registration runs at app startup; document engines (and the PDF worker blob)
// belong to the selected preview, not to every ordinary chat window.
const PdfPreview = lazy(() => import("./components/PdfPreview").then((module) => ({ default: module.PdfPreview })));
const DocxPreview = lazy(() => import("./components/DocxPreview").then((module) => ({ default: module.DocxPreview })));
const PptxPreview = lazy(() => import("./components/PptxPreview").then((module) => ({ default: module.PptxPreview })));
const SpreadsheetPreview = lazy(() =>
	import("./components/spreadsheet/SpreadsheetPreview").then((module) => ({ default: module.SpreadsheetPreview })),
);

export function OfficePreview(props: PluginFilePreviewProps): JSX.Element {
	const { t } = useTranslation();
	const [revision, setRevision] = useState(0);

	useEffect(() => {
		const watcher = props.file.watch(() => setRevision((value) => value + 1));
		return () => watcher.dispose();
	}, [props.file]);

	const Preview =
		props.file.extension === "pdf"
			? PdfPreview
			: props.file.extension === "docx"
				? DocxPreview
				: props.file.extension === "pptx"
					? PptxPreview
					: isSpreadsheetExtension(props.file.extension)
						? SpreadsheetPreview
						: null;
	if (!Preview) return <ErrorState message={t("error.unsupportedFormat")} />;
	return (
		<Suspense fallback={<LoadingState />}>
			<Preview key={revision} {...props} />
		</Suspense>
	);
}
