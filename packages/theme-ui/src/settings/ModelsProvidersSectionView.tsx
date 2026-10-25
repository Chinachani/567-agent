import type { JSX, ReactNode } from "react";
import { Button } from "@vetta-org/ui";
import { SettingSection, type SettingSectionMeta } from "./SettingChrome";

export interface ModelsProvidersSectionViewLabels {
	readonly localProviders: string;
	readonly addProvider: string;
	readonly noProvidersAdded: string;
}

export interface ModelsProvidersSectionViewProps {
	readonly section: SettingSectionMeta;
	readonly labels: ModelsProvidersSectionViewLabels;
	readonly showAddButton: boolean;
	readonly onStartAdd: () => void;
	readonly empty: boolean;
	readonly rows: ReactNode;
	readonly addForm: ReactNode | null;
	readonly toolbar?: ReactNode;
}

export function ModelsProvidersSectionView({
	section,
	labels,
	showAddButton,
	onStartAdd,
	empty,
	rows,
	addForm,
	toolbar,
}: ModelsProvidersSectionViewProps): JSX.Element {
	return (
		<SettingSection
			section={section}
			title={
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span>{labels.localProviders}</span>
					{showAddButton && (
						<Button variant="ghost" size="sm" onClick={onStartAdd}>
							<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5" />
							{labels.addProvider}
						</Button>
					)}
				</div>
			}
		>
			{toolbar}
			{empty && showAddButton && (
				<div className="px-5 py-8 text-center text-[12px] text-muted-foreground">{labels.noProvidersAdded}</div>
			)}
			{rows}
			{addForm}
		</SettingSection>
	);
}
