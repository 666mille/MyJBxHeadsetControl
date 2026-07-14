import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";
import { builtinModules } from "node:module"; // <-- NEU: Import für Node-Kernmodule

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.holgermilz.myjbxheadsetcontrol.sdPlugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
    input: "src/plugin.ts",
    output: {
        file: `${sdPlugin}/bin/plugin.js`,
        sourcemap: isWatching,
        sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
            return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
        }
    },
    // <-- NEU: Hier sagen wir Rollup, dass es node-hid und Node-Core-Module NICHT bündeln soll
    external: [
        "node-hid",
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`) // Deckt Importe wie "fs" UND "node:fs" ab
    ],
    plugins: [
        {
            name: "watch-externals",
            buildStart: function () {
                this.addWatchFile(`${sdPlugin}/manifest.json`);
            },
        },
        typescript({
            mapRoot: isWatching ? "./" : undefined
        }),
        nodeResolve({
            browser: false,
            exportConditions: ["node"],
            preferBuiltins: true
        }),
        commonjs(),
        !isWatching && terser(),
        {
            name: "emit-module-package-file",
            generateBundle() {
                this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
            }
        }
    ]
};

export default config;