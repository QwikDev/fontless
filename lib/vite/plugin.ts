import type { Plugin } from "vite";
import { createUnifont, providers } from "unifont";

export function fontless(): Plugin {
	return {
		name: "vite-plugin-fontless",

		async configResolved() {
			const unifont = await createUnifont([providers.google()]);
		},

		async transform(code: string, id: string) {
			if (!id.endsWith(".css")) return;
		},
	};
}
