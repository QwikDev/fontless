import type { Plugin } from "vite";
import { createUnifont, providers } from "unifont";
import { parse, walk, type CssNode } from "css-tree";
import { extractFontFamilies } from "../css/parse";

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

			function processNode(node: CssNode) {
				walk(node, {
					visit: 'Declaration',
					enter(node) {
						if (this.atrule?.name === 'font-family' && node.property === 'font-family') {
							for (const family of extractFontFamilies(node)) {
								console.log("family: ", family);
							}
						}
					}
				})
			}

			console.log("ast: ", ast);
		},
	};
}
