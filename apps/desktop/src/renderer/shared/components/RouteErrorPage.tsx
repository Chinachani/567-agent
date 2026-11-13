import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { RouteErrorPageView } from "@vetta-org/theme-ui/overlays";
import { useRouteErrorPageModel } from "../hooks/useRouteErrorPageModel";
import { Button } from "./ui/button";

export function RouteErrorPage(props: ErrorComponentProps): JSX.Element {
	const model = useRouteErrorPageModel(props);
	return (
		<RouteErrorPageView labels={model.labels} message={model.message} onRetry={model.onRetry}>
			<Button type="button" variant="primary" size="sm" onClick={model.onRetry}>
				{model.labels.retryPage}
			</Button>
			{!model.reloadRequired && (
				<Button type="button" variant="outline" size="sm" onClick={model.onReload}>
					{model.labels.reload}
				</Button>
			)}
			{model.reloadRequired ? (
				<Button type="button" variant="outline" size="sm" onClick={model.onReloadHome}>
					{model.labels.home}
				</Button>
			) : (
				<Button type="button" variant="outline" size="sm" asChild>
					<Link to="/">{model.labels.home}</Link>
				</Button>
			)}
		</RouteErrorPageView>
	);
}
