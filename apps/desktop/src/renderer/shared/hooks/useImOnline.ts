import type { ImBridgeStatus } from "@preload/api-types/im";
import { useEffect, useState } from "react";

function hasOnlineChannel(status: ImBridgeStatus): boolean {
	return status.channelStatuses
		? Object.values(status.channelStatuses).includes("online")
		: status.transport === "online" || status.transport === "connecting";
}

export function useImOnline(): boolean {
	const [online, setOnline] = useState(false);

	useEffect(() => {
		let cancelled = false;
		let receivedStatus = false;
		let unsub: (() => void) | null = null;
		void (async () => {
			try {
				const unsubFn = await window.agent567.im.subscribeStatus(
					(status) => {
						receivedStatus = true;
						if (!cancelled) setOnline(hasOnlineChannel(status));
					},
					() => {},
				);
				if (cancelled) {
					unsubFn();
					return;
				}
				unsub = unsubFn;
				// subscribeStatus 的首帧与监听器挂载存在竞态，显式拉一次 seed 初始态。
				const current = await window.agent567.im.getStatus();
				if (!cancelled && !receivedStatus) setOnline(hasOnlineChannel(current));
			} catch {
				// ignore; 徽章保持隐藏
			}
		})();
		return () => {
			cancelled = true;
			unsub?.();
		};
	}, []);

	return online;
}
