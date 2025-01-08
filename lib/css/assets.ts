import fsp from "node:fs/promises";
import { hash } from "ohash";
import { extname, join } from "pathe";
import { filename } from "pathe/utils";
import { hasProtocol, joinRelativeURL, joinURL } from "ufo";
import type { FontFaceData } from "unifont";
import { storage } from "../cache";
import type { Options, RawFontFaceData } from "../types";
import { formatToExtension, parseFont } from "./render";

const renderedFontURLs = new Map<string, string>();

export async function setupPublicAssetStrategy(options: Options) {
  const { module } = options;

  const assetsBaseURL = module.assets.prefix || "/fonts";

  function normalizeFontData(
    faces: RawFontFaceData | FontFaceData[]
  ): FontFaceData[] {
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
                (extname(source.url) || formatToExtension(source.format) || ""),
            ]
              .filter(Boolean)
              .join("-");

            renderedFontURLs.set(file, source.url);
            source.originalURL = source.url;

            source.url = options.fontless.dev
              ? joinRelativeURL(assetsBaseURL, file)
              : joinURL(assetsBaseURL, file);
          }

          return source;
        }),
      });
    }
    return data;
  }

  const rollupBefore = async () => {
    for (const [filename, url] of renderedFontURLs) {
      const key = "data:fonts:" + filename;
      // Use storage to cache the font data between builds
      let res = await storage.getItemRaw(key);
      if (!res) {
        res = await fetch(url)
          .then((r) => r.arrayBuffer())
          .then((r) => Buffer.from(r));

        await storage.setItemRaw(key, res);
      }

      // TODO: investigate how we can improve in dev surround
      await fsp.mkdir(join(options.fontless.baseURL, assetsBaseURL), {
        recursive: true,
      });

      await fsp.writeFile(
        joinRelativeURL(options.fontless.baseURL, assetsBaseURL, filename),
        res
      );
    }
  };

  options.hooks["rollup:before"] = rollupBefore;

  return {
    normalizeFontData,
  };
}
