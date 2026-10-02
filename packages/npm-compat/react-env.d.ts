import type { JSX as ReactJSX } from "react";

// The original frontend packages expect the host's React JSX namespace.
declare global {
	namespace JSX {
		type Element = ReactJSX.Element;
		type IntrinsicElements = ReactJSX.IntrinsicElements;
	}
}
