/**
 * 先把画布 chunk 取回求值，再翻开面板。画布 Tab 是懒加载的：直接开面板的话，
 * chunk 的解析、求值与首帧渲染全压在面板滑出动画那 200ms 里，主线程一停，动画
 * 就卡在半路。预热失败（离线、包损坏）不拦打开——面板照常开，让 React lazy 那
 * 条路去报错；预热期间会话已经切走则放弃，别把画布开到别人的面板里。
 */
export async function openCanvasAfterWarmup(
	warm: () => Promise<unknown>,
	isStale: () => boolean,
	open: () => void,
): Promise<void> {
	await warm().catch(() => undefined);
	if (isStale()) return;
	open();
}
