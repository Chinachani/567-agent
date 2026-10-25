import { Button } from "@shared/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/components/ui/select";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { api567RouteOrigin, isApi567RouteId, type Api567ServiceRoute } from "../../../../shared/service-routes.js";
import { useServiceRoute } from "../hooks/useServiceRoute";

/** Domain connector. Reused in login, account popover and model settings. */
export function ServiceRouteSettings(): JSX.Element {
	const model = useServiceRoute();
	const hintId = useId();
	const { t } = useTranslation("settings");
	const name = (route: Api567ServiceRoute) =>
		route.name ??
		(route.id === "mainland" || route.id === "germany" ? t(`serviceRoute.${route.id}`) : new URL(route.origin).host);
	const routes = [...model.catalog.routes];
	if (model.route && !routes.some((route) => route.id === model.route))
		routes.push({ id: model.route, origin: api567RouteOrigin(model.route) });
	const selected = routes.find((route) => route.id === model.route);
	const result = model.lastRoute ? model.results[model.lastRoute] : undefined;
	return (
		<fieldset
			className="min-w-0 space-y-1.5 py-2"
			disabled={model.pending !== null || (!model.route && !model.configurationError)}
		>
			<legend className="sr-only">{t("serviceRoute.title")}</legend>
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
				<span
					className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground"
					title={t("serviceRoute.hint")}
				>
					<span className="icon-[solar--global-linear] h-3.5 w-3.5" aria-hidden="true" />
					{t("serviceRoute.title")}
				</span>
				<div className="flex min-w-44 flex-1 items-center justify-end gap-1">
					<Select
						value={model.route ?? ""}
						onValueChange={(id) => {
							if (isApi567RouteId(id)) void model.run(id, true);
						}}
						disabled={model.pending !== null || (!model.route && !model.configurationError)}
					>
						<SelectTrigger
							aria-label={t("serviceRoute.choose")}
							aria-describedby={hintId}
							className="h-8 min-w-20 max-w-48 flex-1 text-[12px]"
						>
							<SelectValue>
								{selected
									? name(selected)
									: model.configurationError
										? t("serviceRoute.repairChoose")
										: model.route}
							</SelectValue>
						</SelectTrigger>
						<SelectContent className="max-h-72">
							{routes.map((route) => (
								<SelectItem key={route.id} value={route.id} textValue={name(route)}>
									<span className="block text-[12px]">{name(route)}</span>
									<span
										className="block max-w-64 truncate text-[11px] text-muted-foreground"
										title={route.origin}
									>
										{route.description ?? new URL(route.origin).host}
									</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						variant="ghost"
						size="sm"
						aria-label={t("serviceRoute.probeLabel", { route: selected ? name(selected) : "" })}
						onClick={() => {
							if (model.route) void model.run(model.route, false);
						}}
					>
						{t("serviceRoute.probe")}
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={model.refreshing}
						aria-label={t("serviceRoute.refresh")}
						onClick={() => void model.refresh(true)}
					>
						<span
							className={`icon-[solar--refresh-linear] h-3.5 w-3.5 ${model.refreshing ? "animate-spin" : ""}`}
						/>
					</Button>
				</div>
			</div>
			<p id={hintId} className="sr-only">
				{t("serviceRoute.hint")}
			</p>
			{model.configurationError && (
				<p role="alert" className="text-[11px] text-destructive">
					{t("serviceRoute.configurationError")}
				</p>
			)}
			{result && (
				<p className="text-[11px] text-muted-foreground" role="status">
					{result.ok
						? t("serviceRoute.reachable", { ms: result.elapsedMs })
						: t(`serviceRoute.errors.${result.error ?? "unreachable"}`)}
				</p>
			)}
			{model.catalog.refreshFailed && (
				<p className="text-[11px] text-muted-foreground" role="status">
					{t("serviceRoute.cached")}
				</p>
			)}
			{(model.pending || model.changed) && (
				<p className="text-[11px] leading-relaxed text-muted-foreground" role="status">
					{model.pending ? t("serviceRoute.checking") : t("serviceRoute.changed")}
				</p>
			)}
		</fieldset>
	);
}
