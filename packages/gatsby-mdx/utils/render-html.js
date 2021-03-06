/* eslint-disable no-console */
const webpack = require("webpack");
const path = require("path");
const evaluate = require("eval");

//const StaticSiteGeneratorPlugin = require("static-site-generator-webpack-plugin");
const { cloneDeep } = require("lodash");
const { store } = require("gatsby/dist/redux");
const DataLoader = require("dataloader");

var findAsset = function(src, compilation, webpackStatsJson) {
  if (!src) {
    var chunkNames = Object.keys(webpackStatsJson.assetsByChunkName);

    src = chunkNames[0];
  }

  var asset = compilation.assets[src];

  if (asset) {
    return asset;
  }

  var chunkValue = webpackStatsJson.assetsByChunkName[src];

  if (!chunkValue) {
    return null;
  }
  // Webpack outputs an array for each chunk when using sourcemaps
  if (chunkValue instanceof Array) {
    // Is the main bundle always the first element?
    chunkValue = chunkValue.find(function(filename) {
      return /\.js$/.test(filename);
    });
  }
  return compilation.assets[chunkValue];
};

let renderMdxBody = undefined;
class MdxHtmlBuilderWebpackPlugin {
  apply(compiler) {
    const self = this;
    var afterEmit = (compilation, callback) => {
      //      var options = compiler.options;
      /* var stats = compilation.getStats().toJson({
       *   hash: true,
       *   publicPath: true,
       *   assets: true,
       *   chunks: false,
       *   modules: false,
       *   source: false,
       *   errorDetails: false,
       *   timings: false
       * }); */
      //      console.log(Object.keys(compilation.assets));
      var webpackStats = compilation.getStats();
      var webpackStatsJson = webpackStats.toJson();

      try {
        var asset = findAsset(self.entry, compilation, webpackStatsJson);

        if (asset == null) {
          throw new Error('Source file not found: "' + self.entry + '"');
        }

        var source = asset.source();
        var render = evaluate(
          source,
          /* filename: */ self.entry,
          /* scope: */ self.globals,
          /* includeGlobals: */ true
        );

        if (render.hasOwnProperty("default")) {
          render = render["default"];
        }

        if (typeof render !== "function") {
          throw new Error(
            `Export from '${
              self.entry
            }'  must be a function that returns a htmlString value.`
          );
        }
        // use function here
        renderMdxBody = render;
        callback();
      } catch (err) {
        compilation.errors.push(err.stack);
        callback();
      }
    };
    if (compiler.hooks) {
      var plugin = { name: "MdxHtmlBuilderWebpackPlugin" };

      compiler.hooks.afterEmit.tapAsync(plugin, afterEmit);
    } else {
      compiler.plugin("after-emit", afterEmit);
    }
  }
}

exports.mdxHTMLLoader = ({ cache, reporter }) =>
  new DataLoader(
    async keys => {
      const webpackConfig = cloneDeep(store.getState().webpack);
      // something sets externals, which will cause React to be undefined
      webpackConfig.externals = undefined;
      webpackConfig.entry = require.resolve("./wrap-root-render-html-entry.js");
      webpackConfig.output = {
        filename: "output.js",
        path: path.join(cache.directory, "webpack"),
        libraryTarget: "commonjs"
      };
      webpackConfig.plugins.push(new MdxHtmlBuilderWebpackPlugin());
      const compiler = webpack(webpackConfig);

      return new Promise(resolve => {
        compiler.run((err, stats) => {
          // error handling bonanza
          if (err) {
            console.error(err.stack || err);
            if (err.details) {
              console.error(err.details);
            }
            return;
          }

          const info = stats.toJson();

          if (stats.hasErrors()) {
            console.error(info.errors);
          }

          if (stats.hasWarnings()) {
            console.warn(info.warnings);
          }

          resolve(
            keys.map(
              ({ body }) =>
                renderMdxBody
                  ? renderMdxBody(body)
                  : reporter.error(
                      `gatsby-mdx: renderMdxBody was unavailable when rendering html. 
>> This is a bug.`
                    )
            )
          );
        });
      });
    },
    { cacheKeyFn: ({ id }) => id }
  );
