import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BridgeHub } from "../../../../packages/plugins/presets/vetta-ui-design/src/canvas/bridge-client";
import { FrameView } from "../../../../packages/plugins/presets/vetta-ui-design/src/canvas/FrameView";
import { useFrameRasters } from "../../../../packages/plugins/presets/vetta-ui-design/src/canvas/frame-raster";
import { useViewport } from "../../../../packages/plugins/presets/vetta-ui-design/src/canvas/use-viewport";
import { setPluginCtx } from "../../../../packages/plugins/presets/vetta-ui-design/src/plugin-context";
import "./canvas-fixture.css";

const port = Number(new URLSearchParams(location.search).get("port"));
const raster =
	"data:image/svg+xml," +
	encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="390" height="300"><rect width="390" height="300" fill="#123456"/></svg>',
	);
setPluginCtx({
	capture: { offscreen: async () => ({ dataUrl: raster, scaleFactor: 1 }), releaseOffscreen: async () => {} },
});
window.canvasProbe = { wheels: [], ready: 0, errors: [], states: [] };
window.addEventListener("message", (event) => {
	if (event.source === document.querySelector("iframe")?.contentWindow && event.data?.type === "ready")
		window.canvasProbe.ready++;
});
const noop = () => {};
const frameIds = ["index"];
const offscreen = { port, sizeOf: () => ({ width: 390, height: 300 }) };
function App() {
	const [bridge] = useState(() => new BridgeHub());
	const [paintTick, setPaintTick] = useState(0);
	const [activeFrameId, setActiveFrameId] = useState(null);
	const view = useViewport({ initial: { x: 100, y: 100, zoom: 1 }, onCommit: noop });
	const rasters = useFrameRasters({
		bridge,
		cacheKey: "/fixture/design.vetd",
		frameIds,
		activeFrameId,
		interacting: view.interacting,
		offscreen,
	});
	const hasRaster = !!rasters.rasterOf("index");
	useEffect(() => {
		if (hasRaster) setActiveFrameId("index");
	}, [hasRaster]);
	const current = useRef({ view, rasters });
	current.current = { view, rasters };
	useEffect(() => {
		bridge.start({
			onSelected: noop,
			onExitInspect: noop,
			onHmrUpdated: noop,
			onFrameContextMenu: noop,
			onFrameSpace: noop,
			onFrameError: (_id, error) => {
				if (error) window.canvasProbe.errors.push(error);
			},
			onRendered: (id) => {
				setPaintTick((tick) => tick + 1);
				current.current.rasters.notifyRendered(id);
			},
			onFrameWheel: (event) => {
				window.canvasProbe.wheels.push({ ...event, source: "frame" });
				current.current.view.applyWheel(event);
			},
		});
		bridge.setMode("index", "inspect");
		return () => bridge.stop();
	}, [bridge]);
	// Chromium can retarget wheel ticks to the host while an out-of-process frame transforms.
	// Mount the same host listener as DesignCanvas, alongside the iframe bridge path.
	useEffect(() => {
		const container = view.containerRef.current;
		const onWheel = (event) => {
			event.preventDefault();
			window.canvasProbe.wheels.push({ deltaX: event.deltaX, deltaY: event.deltaY, source: "host" });
			current.current.view.applyWheel(event);
		};
		container.addEventListener("wheel", onWheel, { passive: false });
		return () => container.removeEventListener("wheel", onWheel);
	}, [view.containerRef]);
	useEffect(() => {
		window.canvasProbe.states.push({
			interacting: view.interacting,
			parked: rasters.isParked("index"),
			display: document.querySelector("iframe")?.style.display,
		});
	}, [view.interacting, rasters.isParked]);
	window.canvasProbe.read = () => ({
		...view.viewportRef.current,
		parked: rasters.isParked("index"),
		raster: !!rasters.rasterOf("index"),
		paintTick,
	});
	return (
		<div ref={view.containerRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
			<div ref={view.worldRef} style={{ transform: view.worldTransform, transformOrigin: "0 0" }}>
				<FrameView
					frame={{ id: "index", title: "Fixture", x: 0, y: 0, width: 390, height: 300 }}
					port={port}
					getZoom={() => current.current.view.viewportRef.current.zoom}
					bridge={bridge}
					selected
					entered
					interactive
					resizable={false}
					menuItems={null}
					onMenuSlot={noop}
					mounted={rasters.isMounted("index")}
					live={rasters.isLive("index")}
					parked={rasters.isParked("index")}
					raster={rasters.rasterOf("index")}
					reloadNonce={0}
					paintTick={paintTick}
					moveDelta={null}
					resizeRect={null}
					placement={null}
					activity={undefined}
					buildError={null}
					renaming={false}
					onSelect={noop}
					onContextMenu={noop}
					onRenameStart={noop}
					onRenameCommit={noop}
					onRenameCancel={noop}
					onDragStart={noop}
					onDragDelta={noop}
					onDragEnd={noop}
					onRadiusCommit={noop}
				/>
			</div>
		</div>
	);
}
createRoot(document.getElementById("root")).render(<App />);
