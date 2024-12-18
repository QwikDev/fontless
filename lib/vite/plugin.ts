import type { Plugin } from "vite";
import { createUnifont, providers, RemoteFontSource } from "unifont";
import { parse, walk, type CssNode } from "css-tree";
import { extractEndOfFirstChild, extractFontFamilies, extractGeneric, GenericCSSFamily } from "../css/parse";
import { Awaitable, FontFaceData } from "../types";

export interface FontFaceResolution {
	fonts?: FontFaceData[]
	fallbacks?: string[]
  }

// FontFamilyInjectionPluginOptions in nuxt fonts
interface FontlessOptions {
	resolveFontFace: (fontFamily: string, fallbackOptions?: { fallbacks: string[], generic?: GenericCSSFamily }) => Awaitable<undefined | FontFaceResolution>
	dev: boolean
	processCSSVariables?: boolean
	shouldPreload: (fontFamily: string, font: FontFaceData) => boolean
	fontsToPreload: Map<string, Set<string>>
  }

export function fontless(options: FontlessOptions): Plugin {
	return {
		name: "vite-plugin-fontless",

		async configResolved() {
			console.log("LOG: fontless - configResolved");
			const unifont = await createUnifont([providers.google()]);
		},

		async transform(code: string, id: string) {
			if (!id.includes(".css")) return;

			const ast = parse(code, { positions: true });
			const existingFontFamilies = new Set<string>();
			const promises = [] as Promise<unknown>[];

			// async function addFontFaceDeclaration(fontFamily: string, fallbackOptions?: {
			// 	generic?: GenericCSSFamily
			// 	fallbacks: string[]
			// 	index: number
			//   }) {
			// 	const result = await options.resolveFontFace(fontFamily, {
			// 	  generic: fallbackOptions?.generic,
			// 	  fallbacks: fallbackOptions?.fallbacks || [],
			// 	}) || {}
		  
			// 	if (!result.fonts || result.fonts.length === 0) return
		  
			// 	const fallbackMap = result.fallbacks?.map(f => ({ font: f, name: `${fontFamily} Fallback: ${f}` })) || []
			// 	let insertFontFamilies = false
		  
			// 	if (result.fonts[0] && options.shouldPreload(fontFamily, result.fonts[0])) {
			// 	  const fontToPreload = result.fonts[0].src.find((s): s is RemoteFontSource => 'url' in s)?.url
			// 	  if (fontToPreload) {
			// 		const urls = options.fontsToPreload.get(id) || new Set()
			// 		options.fontsToPreload.set(id, urls.add(fontToPreload))
			// 	  }
			// 	}
		  
			// 	const prefaces: string[] = []
		  
			// 	for (const font of result.fonts) {
			// 	  const fallbackDeclarations = await generateFontFallbacks(fontFamily, font, fallbackMap)
			// 	  const declarations = [generateFontFace(fontFamily, opts.relative ? relativiseFontSources(font, withLeadingSlash(dirname(id))) : font), ...fallbackDeclarations]
		  
			// 	  for (let declaration of declarations) {
			// 		if (!injectedDeclarations.has(declaration)) {
			// 		  injectedDeclarations.add(declaration)
			// 		  if (!options.dev) {
			// 			declaration = await transform(declaration, {
			// 			  loader: 'css',
			// 			  charset: 'utf8',
			// 			  minify: true,
			// 			  ...postcssOptions,
			// 			}).then(r => r.code || declaration).catch(() => declaration)
			// 		  }
			// 		  else {
			// 			declaration += '\n'
			// 		  }
			// 		  prefaces.push(declaration)
			// 		}
			// 	  }
		  
			// 	  // Add font family names for generated fallbacks
			// 	  if (fallbackDeclarations.length) {
			// 		insertFontFamilies = true
			// 	  }
			// 	}
		  
			// 	s.prepend(prefaces.join(''))
		  
			// 	if (fallbackOptions && insertFontFamilies) {
			// 	  const insertedFamilies = fallbackMap.map(f => `"${f.name}"`).join(', ')
			// 	  s.prependLeft(fallbackOptions.index, `, ${insertedFamilies}`)
			// 	}
			//   }

			function processNode(node: CssNode, parentOffset = 0) {
				walk(node, {
					visit: 'Declaration',
					enter(node) {
						console.log('this: ', this)
						if (this.atrule?.name === 'font-family' && node.property === 'font-family') {
							for (const family of extractFontFamilies(node)) {
								console.log("family: ", family);
								existingFontFamilies.add(family);
							}
						}
					}
				})

				walk(node, {
					visit: 'Declaration',
					enter(node) {
					  if (((node.property !== 'font-family' && node.property !== 'font') && (!options.processCSSVariables || !node.property.startsWith('--'))) || this.atrule?.name === 'font-face') {
						return
					  }
			
					  // Only add @font-face for the first font-family in the list and treat the rest as fallbacks
					  const [fontFamily, ...fallbacks] = extractFontFamilies(node)
					//   if (fontFamily && !existingFontFamilies.has(fontFamily)) {
					// 	promises.push(addFontFaceDeclaration(fontFamily, node.value.type !== 'Raw'
					// 	  ? {
					// 		  fallbacks,
					// 		  generic: extractGeneric(node),
					// 		  index: extractEndOfFirstChild(node)! + parentOffset,
					// 		}
					// 	  : undefined))
					//   }
					},
				  })
			
				  // Process nested CSS until `css-tree` supports it: https://github.com/csstree/csstree/issues/268#issuecomment-2417963908
				//   walk(node, {
				// 	visit: 'Raw',
				// 	enter(node) {
				// 	  const nestedRaw = parse(node.value, { positions: true }) as StyleSheet
				// 	  const isNestedCss = nestedRaw.children.some(child => child.type === 'Rule')
				// 	  if (!isNestedCss) return
				// 	  parentOffset += node.loc!.start.offset
				// 	  processNode(nestedRaw, parentOffset)
				// 	},
				//   })
			}

			processNode(ast);

			await Promise.all(promises)
		},
	};
}
