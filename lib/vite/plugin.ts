import type { Plugin } from "vite";
import { createUnifont, providers } from "unifont";
import { parse, walk } from "css-tree";

export function fontless(): Plugin {
	return {
		name: "vite-plugin-fontless",

		async configResolved() {
			console.log("LOG: fontless - configResolved");
			const unifont = await createUnifont([providers.google()]);
		},

		async transform(code: string, id: string) {
			if (!id.includes(".css")) return;

			const ast = parse(code, { positions: true });

			console.log("ast: ", ast);
		},
	};
}
