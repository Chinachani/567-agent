/** Hint each video codec independently; leave codec profiles and nonvideo payloads intact. */
export function answerWithStartBitrate(sdp: string): string {
	const video = new Set<string>();
	for (const match of sdp.matchAll(/^a=rtpmap:(\d+) (?:H264|H265|VP8|VP9|AV1)\//gim)) video.add(match[1] ?? "");
	return sdp.replace(/^a=fmtp:(\d+) [^\r\n]*/gm, (line, payload: string) =>
		video.has(payload) && !line.includes("x-google-start-bitrate") ? `${line};x-google-start-bitrate=4000` : line,
	);
}
export function preferHardwareCodec(transceiver: RTCRtpTransceiver): void {
	if (typeof transceiver.setCodecPreferences !== "function" || typeof RTCRtpReceiver === "undefined") return;
	const codecs = RTCRtpReceiver.getCapabilities?.("video")?.codecs;
	if (!codecs?.length) return;
	const h264 = codecs.filter((codec) => codec.mimeType.toLowerCase() === "video/h264");
	if (!h264.length) return;
	try {
		transceiver.setCodecPreferences([...h264, ...codecs.filter((codec) => !h264.includes(codec))]);
	} catch {
		/* Browser default remains a fallback. */
	}
}
