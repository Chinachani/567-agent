import { NewSessionOptionsRow, type NewSessionOptionsRowProps } from "./NewSessionOptionsRow";

/** Setup stays in the input surface; container queries keep narrow columns in two rows. */
export function NewSessionSetupControls(props: Omit<NewSessionOptionsRowProps, "showProjectSelector">): JSX.Element {
	return (
		<div className="border-b border-border/50 px-3 py-2.5">
			<div className="@container">
				<NewSessionOptionsRow {...props} />
			</div>
		</div>
	);
}
