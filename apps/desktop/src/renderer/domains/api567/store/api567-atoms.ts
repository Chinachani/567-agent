import type { Api567Status } from "@preload/api-types/567api.js";
import { atom } from "jotai";

export const api567StatusAtom = atom<Api567Status>({
	isLoggedIn: false,
});

export const api567AvailableGroupsAtom = atom<Record<string, { desc: string; ratio: number }>>({});
export const api567InitialCheckDoneAtom = atom<boolean>(false);
export const api567AuthModalOpenAtom = atom<boolean>(false);
