import type { ESBuildOptions, Plugin } from "vite";
import { createUnifont, providers, RemoteFontSource } from "unifont";
import { parse, walk } from "css-tree";
import type { CssNode, StyleSheet } from "css-tree";
import {
  addLocalFallbacks,
  extractEndOfFirstChild,
  extractFontFamilies,
  extractGeneric,
  GenericCSSFamily,
} from "../css/parse";
import {
  FontFaceData,
  FontFamilyManualOverride,
  FontFamilyProviderOverride,
  ModuleOptions,
  RawFontFaceData,
} from "../types";
import {
  formatToExtension,
  generateFontFace,
  generateFontFallbacks,
  parseFont,
  relativiseFontSources,
} from "../css/render";
import { hasProtocol, joinURL, withLeadingSlash } from "ufo";
import { transform } from "esbuild";
import type { TransformOptions } from "esbuild";
import MagicString from "magic-string";
import { dirname, extname } from "pathe";
import { filename } from "pathe/utils";
import { hash } from "ohash";

export interface FontFaceResolution {
  fonts?: FontFaceData[];
  fallbacks?: string[];
}

interface FontlessOptions {
  dev: boolean;
  processCSSVariables?: boolean;
  shouldPreload: (fontFamily: string, font: FontFaceData) => boolean;
  fontsToPreload: Map<string, Set<string>>;
}

const SKIP_RE = /\/node_modules\/vite-plugin-vue-inspector\//;

const defaultValues = {
  weights: [400],
  styles: ["normal", "italic"] as const,
  subsets: [
    "cyrillic-ext",
    "cyrillic",
    "greek-ext",
    "greek",
    "vietnamese",
    "latin-ext",
    "latin",
  ],
  fallbacks: {
    serif: ["Times New Roman"],
    "sans-serif": ["Arial"],
    monospace: ["Courier New"],
    cursive: [],
    fantasy: [],
    "system-ui": [
      "BlinkMacSystemFont",
      "Segoe UI",
      "Roboto",
      "Helvetica Neue",
      "Arial",
    ],
    "ui-serif": ["Times New Roman"],
    "ui-sans-serif": ["Arial"],
    "ui-monospace": ["Courier New"],
    "ui-rounded": [],
    emoji: [],
    math: [],
    fangsong: [],
  },
} satisfies ModuleOptions["defaults"];

const defaultModule = {
  devtools: true,
  experimental: {
    processCSSVariables: false,
    disableLocalFallbacks: false,
  },
  defaults: {},
  assets: {
    prefix: "/_fonts",
  },
  local: {},
  google: {},
  adobe: {
    id: "",
  },
  providers: {
    // should import with Jiti
    // local, //TODO
    adobe: providers.adobe,
    google: providers.google,
    googleicons: providers.googleicons,
    bunny: providers.bunny,
    fontshare: providers.fontshare,
    fontsource: providers.fontsource,
  },
};

export const fontless = (
  moduleOption: ModuleOptions = defaultModule,
  options: FontlessOptions = {
    dev: false,
    processCSSVariables: false,
    shouldPreload: () => false,
    fontsToPreload: new Map(),
  }
): Plugin => {
  let postcssOptions: Parameters<typeof transform>[1] | undefined;

  async function transformCSS(
    code: string,
    id: string,
    opts: { relative?: boolean } = {}
  ) {
    const s = new MagicString(code);

    const injectedDeclarations = new Set<string>();

    const promises = [] as Promise<unknown>[];
    async function addFontFaceDeclaration(
      fontFamily: string,
      fallbackOptions?: {
        generic?: GenericCSSFamily;
        fallbacks: string[];
        index: number;
      }
    ) {
      const resolved = await defaultResolveFontFace(moduleOption, fontFamily, {
        generic: fallbackOptions?.generic,
        fallbacks: fallbackOptions?.fallbacks || [],
      });
      const result = resolved || {};

      if (!result.fonts || result.fonts.length === 0) return;

      const fallbackMap =
        result.fallbacks?.map((f) => ({
          font: f,
          name: `${fontFamily} Fallback: ${f}`,
        })) || [];
      let insertFontFamilies = false;

      if (
        result.fonts[0] &&
        options.shouldPreload(fontFamily, result.fonts[0])
      ) {
        const fontToPreload = result.fonts[0].src.find(
          (s): s is RemoteFontSource => "url" in s
        )?.url;
        if (fontToPreload) {
          const urls = options.fontsToPreload.get(id) || new Set();
          options.fontsToPreload.set(id, urls.add(fontToPreload));
        }
      }

      const prefaces: string[] = [];

      for (const font of result.fonts) {
        const fallbackDeclarations = await generateFontFallbacks(
          fontFamily,
          font,
          fallbackMap
        );
        const declarations = [
          generateFontFace(
            fontFamily,
            opts.relative
              ? relativiseFontSources(font, withLeadingSlash(dirname(id)))
              : font
          ),
          ...fallbackDeclarations,
        ];

        for (let declaration of declarations) {
          if (!injectedDeclarations.has(declaration)) {
            injectedDeclarations.add(declaration);
            if (!options.dev) {
              declaration = await transform(declaration, {
                loader: "css",
                charset: "utf8",
                minify: true,
                ...postcssOptions,
              })
                .then((r) => r.code || declaration)
                .catch(() => declaration);
            } else {
              declaration += "\n";
            }
            prefaces.push(declaration);
          }
        }

        // Add font family names for generated fallbacks
        if (fallbackDeclarations.length) {
          insertFontFamilies = true;
        }
      }

      s.prepend(prefaces.join(""));

      if (fallbackOptions && insertFontFamilies) {
        const insertedFamilies = fallbackMap
          .map((f) => `"${f.name}"`)
          .join(", ");
        s.prependLeft(fallbackOptions.index, `, ${insertedFamilies}`);
      }
    }

    const ast = parse(code, { positions: true });

    // Collect existing `@font-face` declarations (to skip adding them)
    const existingFontFamilies = new Set<string>();

    // For nested CSS we need to keep track how long the parent selector is
    function processNode(node: CssNode, parentOffset = 0) {
      walk(node, {
        visit: "Declaration",
        enter(node) {
          if (
            this.atrule?.name === "font-face" &&
            node.property === "font-family"
          ) {
            for (const family of extractFontFamilies(node)) {
              existingFontFamilies.add(family);
            }
          }
        },
      });

      walk(node, {
        visit: "Declaration",
        enter(node) {
          if (
            (node.property !== "font-family" &&
              node.property !== "font" &&
              (!options.processCSSVariables ||
                !node.property.startsWith("--"))) ||
            this.atrule?.name === "font-face"
          ) {
            return;
          }

          // Only add @font-face for the first font-family in the list and treat the rest as fallbacks
          const [fontFamily, ...fallbacks] = extractFontFamilies(node);
          if (fontFamily && !existingFontFamilies.has(fontFamily)) {
            promises.push(
              addFontFaceDeclaration(
                fontFamily,
                node.value.type !== "Raw"
                  ? {
                      fallbacks,
                      generic: extractGeneric(node),
                      index: extractEndOfFirstChild(node)! + parentOffset,
                    }
                  : undefined
              )
            );
          }
        },
      });

      // Process nested CSS until `css-tree` supports it: https://github.com/csstree/csstree/issues/268#issuecomment-2417963908
      walk(node, {
        visit: "Raw",
        enter(node) {
          const nestedRaw = parse(node.value, {
            positions: true,
          }) as StyleSheet;
          const isNestedCss = nestedRaw.children.some(
            (child) => child.type === "Rule"
          );
          if (!isNestedCss) return;
          parentOffset += node.loc!.start.offset;
          processNode(nestedRaw, parentOffset);
        },
      });
    }

    processNode(ast);

    await Promise.all(promises);

    return s;
  }

  const defaultResolveFontFace = async (
    options: ModuleOptions,
    fontFamily,
    fallbackOptions
  ) => {
    const override = options.families?.find((f) => f.name === fontFamily);

    // This CSS will be injected in a separate location
    if (override?.global) {
      return;
    }

    function addFallbacks(fontFamily: string, font: FontFaceData[]) {
      if (options.experimental?.disableLocalFallbacks) {
        return font;
      }
      return addLocalFallbacks(fontFamily, font);
    }

    function normalizeFontData(
      faces: RawFontFaceData | FontFaceData[]
    ): FontFaceData[] {
      const assetsBaseURL = options.prefix || "/fonts";
      const renderedFontURLs = new Map<string, string>();
      const data: FontFaceData[] = [];
      for (const face of Array.isArray(faces) ? faces : [faces]) {
        data.push({
          ...face,
          unicodeRange:
            face.unicodeRange === undefined || Array.isArray(face.unicodeRange)
              ? face.unicodeRange
              : [face.unicodeRange],
          src: (Array.isArray(face.src) ? face.src : [face.src]).map((src) => {
            const source = typeof src === "string" ? parseFont(src) : src;
            if (
              "url" in source &&
              hasProtocol(source.url, { acceptRelative: true })
            ) {
              source.url = source.url.replace(/^\/\//, "https://");
              const file = [
                // TODO: investigate why negative ignore pattern below is being ignored
                filename(source.url.replace(/\?.*/, "")).replace(/^-+/, ""),
                hash(source) +
                  (extname(source.url) ||
                    formatToExtension(source.format) ||
                    ""),
              ]
                .filter(Boolean)
                .join("-");

              renderedFontURLs.set(file, source.url);
              source.originalURL = source.url;
              source.url = joinURL(assetsBaseURL, file);
            }
            return source;
          }),
        });
      }
      return data;
    }

    async function resolveFontFaceWithOverride(
      fontFamily: string,
      override?: FontFamilyManualOverride | FontFamilyProviderOverride,
      fallbackOptions?: { fallbacks: string[]; generic?: GenericCSSFamily }
    ): Promise<FontFaceResolution | undefined> {
      const normalizedDefaults = {
        weights: (options.defaults?.weights || defaultValues.weights).map((v) =>
          String(v)
        ),
        styles: options.defaults?.styles || defaultValues.styles,
        subsets: options.defaults?.subsets || defaultValues.subsets,
        fallbacks: Object.fromEntries(
          Object.entries(defaultValues.fallbacks).map(([key, value]) => [
            key,
            Array.isArray(options.defaults?.fallbacks)
              ? options.defaults.fallbacks
              : options.defaults?.fallbacks?.[key as GenericCSSFamily] || value,
          ])
        ) as Record<GenericCSSFamily, string[]>,
      };

      const fallbacks =
        normalizedDefaults.fallbacks[fallbackOptions?.generic || "sans-serif"];

      if (override && "src" in override) {
        const fonts = addFallbacks(
          fontFamily,
          normalizeFontData({
            src: override.src,
            display: override.display,
            weight: override.weight,
            style: override.style,
          })
        );

        return {
          fallbacks,
          fonts,
        };
      }

      // Respect fonts that should not be resolved through `@nuxt/fonts`
      if (override?.provider === "none") {
        return;
      }

      // Respect custom weights, styles and subsets options
      const defaults = { ...normalizedDefaults, fallbacks };
      for (const key of ["weights", "styles", "subsets"] as const) {
        if (override?.[key]) {
          defaults[key as "weights"] = override[key]!.map((v) => String(v));
        }
      }

      const unifont = await createUnifont([providers.google()]);

      // Handle explicit provider
      if (override?.provider) {
        if (override.provider in providers) {
          const result = await unifont.resolveFont(fontFamily, defaults, [
            override.provider,
          ]);
          // Rewrite font source URLs to be proxied/local URLs
          const fonts = normalizeFontData(result?.fonts || []);
          if (!fonts.length || !result) {
            console.warn(
              `Could not produce font face declaration from \`${override.provider}\` for font family \`${fontFamily}\`.`
            );
            return;
          }
          const fontsWithLocalFallbacks = addFallbacks(fontFamily, fonts);
          return {
            fallbacks: result.fallbacks || defaults.fallbacks,
            fonts: fontsWithLocalFallbacks,
          };
        }
      }

      const result = await unifont.resolveFont(fontFamily, defaults);
      if (result) {
        // Rewrite font source URLs to be proxied/local URLs
        const fonts = normalizeFontData(result.fonts);
        if (fonts.length > 0) {
          const fontsWithLocalFallbacks = addFallbacks(fontFamily, fonts);

          return {
            fallbacks: result.fallbacks || defaults.fallbacks,
            fonts: fontsWithLocalFallbacks,
          };
        }
        if (override) {
          console.warn(
            `Could not produce font face declaration for \`${fontFamily}\` with override.`
          );
        }
      }
    }

    return resolveFontFaceWithOverride(fontFamily, override, fallbackOptions);
  };

  return {
    name: "vite-plugin-fontless",
    configResolved(config) {
      if (options.dev || !config.esbuild || postcssOptions) {
        return;
      }

      postcssOptions = {
        target: config.esbuild.target ?? "chrome",
        ...resolveMinifyCssEsbuildOptions(config.esbuild),
      };
    },
    renderChunk(code, chunk) {
      if (chunk.facadeModuleId) {
        for (const file of chunk.moduleIds) {
          if (options.fontsToPreload.has(file)) {
            options.fontsToPreload.set(
              chunk.facadeModuleId,
              options.fontsToPreload.get(file)!
            );
          }
        }
      }
    },
    async transform(code, id) {
      // Early return if no font-family is used in this CSS
      if (!options.processCSSVariables && !code.includes("font-family:")) {
        return;
      }

      const s = await transformCSS(code, id);

      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: s.generateMap({ hires: true }),
        };
      }
    },
  };
};

function resolveMinifyCssEsbuildOptions(
  options: ESBuildOptions
): TransformOptions {
  const base: TransformOptions = {
    charset: options.charset ?? "utf8",
    logLevel: options.logLevel,
    logLimit: options.logLimit,
    logOverride: options.logOverride,
    legalComments: options.legalComments,
  };

  if (
    options.minifyIdentifiers != null ||
    options.minifySyntax != null ||
    options.minifyWhitespace != null
  ) {
    return {
      ...base,
      minifyIdentifiers: options.minifyIdentifiers ?? true,
      minifySyntax: options.minifySyntax ?? true,
      minifyWhitespace: options.minifyWhitespace ?? true,
    };
  }

  return { ...base, minify: true };
}
