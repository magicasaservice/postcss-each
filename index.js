const postcss = require("postcss");
const vars = require("postcss-simple-vars");

const PLUGIN_NAME = "postcss-each";
const SEPARATOR = /\s+in\s+/;

function checkParams(params) {
  if (!SEPARATOR.test(params)) return 'Missed "in" keyword in @each';

  const [name, values] = params.split(SEPARATOR).map((str) => str.trim());

  if (!name.match(/\$[_a-zA-Z]?\w+/)) return "Missed variable name in @each";
  if (!values.match(/(\w+\,?\s?)+/)) return "Missed values list in @each";

  return null;
}

function tokenize(str) {
  return postcss.list.comma(str).map((str) => str.replace(/^\$/, ""));
}

function paramsList(params) {
  let [vars, values] = params.split(SEPARATOR).map(tokenize);
  let matched = false;

  values = values.map((value) => {
    let match = value.match(/^\((.*)\)$/);
    if (match) matched = true;
    return match ? postcss.list.comma(match[1]) : value;
  });

  values = matched ? values : [values];

  return {
    names: values.map((_, i) => vars[i]),
    indexName: vars[values.length],
    values: values,
  };
}

function processRules(rule, params) {
  params.values[0].forEach((_, i) => {
    let vals = {};

    params.names.forEach((name, j) => {
      vals[name] = params.values[j][i];
    });

    if (params.indexName) vals[params.indexName] = i;

    rule.nodes.forEach((node) => {
      const proxy = postcss.rule({ nodes: [node] });
      const { root } = postcss([vars({ only: vals })]).process(proxy);
      rule.parent.insertBefore(rule, root.nodes[0].nodes[0]);
    });
  });
}

function processEach(rule) {
  const params = ` ${rule.params} `;
  const error = checkParams(params);
  if (error) throw rule.error(error);

  const parsedParams = paramsList(params);
  processRules(rule, parsedParams);
  rule.remove();
}

function rulesExists(css) {
  let rulesLength = 0;
  css.walkAtRules("each", () => rulesLength++);
  return rulesLength;
}

async function processLoop(css, afterEach, beforeEach) {
  if (beforeEach) {
    css = await postcss(beforeEach)
      .process(css, { from: undefined })
      .then((result) => {
        return result.root;
      })
      .catch((error) => {
        console.error(error);
      });
  }

  css.walkAtRules("each", async (rule) => {
    processEach(rule);
    await processLoop(rule.root());
  });

  if (afterEach) {
    css = await postcss(afterEach)
      .process(css, { from: undefined })
      .then((result) => {
        return result.root;
      })
      .catch((error) => {
        console.error(error);
      });
  }

  if (rulesExists(css)) await processLoop(css, afterEach, beforeEach);
}

const pluginCreator = (opts = {}) => {
  const hasPlugins = opts && opts.plugins;
  const hasAfterEach =
    hasPlugins && opts.plugins.afterEach && opts.plugins.afterEach.length;
  const hasBeforeEach =
    hasPlugins && opts.plugins.beforeEach && opts.plugins.beforeEach.length;

  if (hasAfterEach || hasBeforeEach) {
    return {
      postcssPlugin: PLUGIN_NAME,
      Once: async (css) =>
        await processLoop(
          css,
          hasAfterEach && opts.plugins.afterEach,
          hasBeforeEach && opts.plugins.beforeEach
        ),
    };
  } else {
    return {
      postcssPlugin: PLUGIN_NAME,
      AtRule: {
        each: processEach,
      },
    };
  }
};

pluginCreator.postcss = true;

module.exports = pluginCreator;
