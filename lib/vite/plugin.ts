import type { transform, TransformOptions } from "esbuild";
import { providers } from "unifont";
import type { ESBuildOptions, Plugin } from "vite";
import { transformCSS } from "../css/transformer";
import local from "../providers/local";
import type { FontlessOptions, Options } from "../types";

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
    local,
    adobe: providers.adobe,
    google: providers.google,
    googleicons: providers.googleicons,
    bunny: providers.bunny,
    fontshare: providers.fontshare,
    fontsource: providers.fontsource,
  },
};

const defaultFontless: FontlessOptions = {
  baseURL: "public",
  dev: process.env.NODE_ENV !== "production",
  processCSSVariables: false,
  shouldPreload: () => false,
  fontsToPreload: new Map(),
};

const defaultOptions: Options = {
  hooks: {},
  module: defaultModule,
  fontless: defaultFontless,
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

export const fontless = (options: Options = defaultOptions): Plugin => {
  const { fontless } = options;
  let postcssOptions: Parameters<typeof transform>[1] | undefined;

  return {
    name: "vite-plugin-fontless",
    configResolved(config) {
      if (fontless.dev || !config.esbuild || postcssOptions) {
        return;
      }

      postcssOptions = {
        target: config.esbuild.target ?? "chrome",
        ...resolveMinifyCssEsbuildOptions(config.esbuild),
      };
    },
    renderChunk(_code, chunk) {
      if (chunk.facadeModuleId) {
        for (const file of chunk.moduleIds) {
          if (fontless.fontsToPreload.has(file)) {
            fontless.fontsToPreload.set(
              chunk.facadeModuleId,
              fontless.fontsToPreload.get(file)!
            );
          }
        }
      }
    },
    async transform(code, id) {
      // Early return if no font-family is used in this CSS
      if (!fontless.processCSSVariables && !code.includes("font-family:")) {
        return;
      }

      const s = await transformCSS(options, code, id, postcssOptions);

      //TODO: Move this to a hook from vite
      options.hooks["rollup:before"]?.(options);

      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: s.generateMap({ hires: true }),
        };
      }
    },
  };
};
