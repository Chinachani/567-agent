import { atom } from "jotai";

interface ExpertPreferences {
	favorites: string[];
	recent: string[];
}
const STORAGE_KEY = "agent567-expert-preferences-v1";
const EMPTY: ExpertPreferences = { favorites: [], recent: [] };

function readPreferences(fallback: ExpertPreferences = EMPTY): ExpertPreferences {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
		if (!value || typeof value !== "object") return EMPTY;
		const list = (items: unknown): string[] =>
			Array.isArray(items)
				? [
						...new Set(
							items.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 512),
						),
					].slice(0, 100)
				: [];
		return {
			favorites: list("favorites" in value ? value.favorites : undefined),
			recent: list("recent" in value ? value.recent : undefined).slice(0, 20),
		};
	} catch {
		return fallback;
	}
}

const preferencesBaseAtom = atom<ExpertPreferences>(EMPTY);
preferencesBaseAtom.onMount = (set) => {
	set(readPreferences());
	const changed = (event: StorageEvent) => {
		if (event.key === STORAGE_KEY || event.key === null) set(readPreferences());
	};
	window.addEventListener("storage", changed);
	return () => window.removeEventListener("storage", changed);
};

/** Device-local directory shortcuts; no prompts, credentials or task content. */
export const expertPreferencesAtom = atom(
	(get) => get(preferencesBaseAtom),
	(get, set, action: { kind: "favorite" | "use"; id: string }) => {
		// Read the current persisted value so another window's favorites are not overwritten.
		const previous = readPreferences(get(preferencesBaseAtom));
		const next =
			action.kind === "use"
				? { ...previous, recent: [action.id, ...previous.recent.filter((id) => id !== action.id)].slice(0, 20) }
				: {
						...previous,
						favorites: previous.favorites.includes(action.id)
							? previous.favorites.filter((id) => id !== action.id)
							: [...previous.favorites, action.id].slice(-100),
					};
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {
			/* Keep usable for this window. */
		}
		set(preferencesBaseAtom, next);
	},
);
