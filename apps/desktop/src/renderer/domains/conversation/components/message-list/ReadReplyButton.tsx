import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// Speech synthesis belongs to the window. A late callback from one row must never stop another row.
let stopCurrent: (() => void) | undefined;

export function ReadReplyButton({ text }: { text: string }) {
	const { t, i18n } = useTranslation("chat");
	const stopMine = useRef<(() => void) | undefined>(undefined);
	const [playing, setPlaying] = useState(false);
	const [unavailable, setUnavailable] = useState(false);
	useEffect(() => () => stopMine.current?.(), [text]);

	function toggle() {
		if (stopMine.current) return stopMine.current();
		stopCurrent?.();
		setUnavailable(false);
		const engine = window.speechSynthesis;
		if (!engine || typeof SpeechSynthesisUtterance !== "function") return setUnavailable(true);
		let offset = 0;
		let current: SpeechSynthesisUtterance | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const stop = () => {
			if (stopCurrent !== stop) return;
			stopCurrent = stopMine.current = undefined;
			clearTimeout(timer);
			engine.removeEventListener("voiceschanged", start);
			document.removeEventListener("visibilitychange", onVisibility);
			if (current) {
				current.onend = current.onerror = null;
				engine.cancel();
			}
			setPlaying(false);
		};
		function onVisibility() {
			if (document.hidden) stop();
		}
		function fail() {
			if (stopCurrent !== stop) return;
			stop();
			setUnavailable(true);
		}
		function start() {
			if (stopCurrent !== stop || current) return;
			let voices: SpeechSynthesisVoice[];
			try {
				voices = engine.getVoices().filter((voice) => voice.localService);
			} catch {
				fail();
				return;
			}
			const language = /\p{Script=Han}/u.test(text.slice(0, 200)) ? "zh" : i18n.language.split("-")[0];
			const voice =
				voices.find((v) => v.lang.split(/[-_]/)[0] === language) ?? voices.find((v) => v.default) ?? voices[0];
			if (!voice) return;
			clearTimeout(timer);
			engine.removeEventListener("voiceschanged", start);
			function next() {
				if (stopCurrent !== stop) return;
				if (offset >= text.length) return stop();
				const rest = text.slice(offset, offset + 240);
				const sentence = rest.match(/^[\s\S]*?[。！？.!?\n](?:\s|$)?/u)?.[0];
				let part = sentence ?? rest;
				if (/[\uD800-\uDBFF]$/.test(part) && offset + part.length < text.length && part.length > 1)
					part = part.slice(0, -1);
				offset += part.length;
				current = new SpeechSynthesisUtterance(part);
				current.voice = voice;
				current.lang = voice.lang;
				const utterance = current;
				current.onend = () => {
					if (current === utterance) next();
				};
				current.onerror = () => {
					if (current === utterance) fail();
				};
				clearTimeout(timer);
				timer = setTimeout(fail, 60_000);
				try {
					engine.speak(current);
				} catch {
					fail();
				}
			}
			next();
		}
		stopCurrent = stopMine.current = stop;
		setPlaying(true);
		document.addEventListener("visibilitychange", onVisibility);
		engine.addEventListener("voiceschanged", start);
		timer = setTimeout(fail, 2500);
		start();
	}
	const label = t(playing ? "messageList.readReply.stop" : "messageList.readReply.play");
	const platform = typeof navigator === "undefined" ? "linux" : navigator.platform.toUpperCase();
	const voiceInstallHint = platform.includes("MAC")
		? t("messageList.readReply.installHint.mac")
		: platform.includes("WIN")
			? t("messageList.readReply.installHint.windows")
			: t("messageList.readReply.installHint.linux");
	return (
		<>
			<button
				type="button"
				title={label}
				aria-label={label}
				aria-pressed={playing}
				onClick={toggle}
				className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/65 hover:bg-muted/60 hover:text-foreground"
			>
				<span
					aria-hidden="true"
					className={playing ? "icon-[mdi--stop] h-3.5 w-3.5" : "icon-[mdi--volume-high] h-3.5 w-3.5"}
				/>
			</button>
			{unavailable && (
				<span role="status" className="flex max-w-[min(28rem,calc(100vw-2rem))] flex-col text-xs text-muted-foreground">
					<span>{t("messageList.readReply.unavailable")}</span>
					<span className="text-[11px] text-muted-foreground/80">{voiceInstallHint}</span>
				</span>
			)}
		</>
	);
}
