// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NewSessionBackground } from "./NewSessionBackground";
afterEach(cleanup);
it.each(["grid", "aurora", "ripple", "none", "unknown"])(
	"ignores retired decoration preference %s without deleting stored data",
	(value) => {
		localStorage.setItem("vetta-new-session-texture", value);
		const { container } = render(<NewSessionBackground />);
		expect(container.firstChild).toBeNull();
		expect(localStorage.getItem("vetta-new-session-texture")).toBe(value);
	},
);
