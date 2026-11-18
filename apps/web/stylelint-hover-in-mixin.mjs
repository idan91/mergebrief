import stylelint from "stylelint";

const {
  utils: { report, ruleMessages, validateOptions },
} = stylelint;

export const ruleName = "house/hover-in-mixin";

const messages = ruleMessages(ruleName, {
  rejected:
    "Put :hover inside `@include mixins.hover`: a touch screen holds :hover after a tap.",
});

const HOVER_INCLUDE = /^(?:[\w-]+\.)?hover(?:[\s(]|$)/;
const HOVER_MEDIA = /\(\s*hover\s*:\s*hover\s*\)/;

function isHoverGuard(node) {
  if (node.type !== "atrule") {
    return false;
  }
  if (node.name === "include") {
    return HOVER_INCLUDE.test(node.params);
  }
  return node.name === "media" && HOVER_MEDIA.test(node.params);
}

function hasHoverGuard(rule) {
  for (let parent = rule.parent; parent !== undefined; parent = parent.parent) {
    if (isHoverGuard(parent)) {
      return true;
    }
  }
  return false;
}

function checkHoverRules(enabled) {
  return (root, result) => {
    if (!validateOptions(result, ruleName, { actual: enabled })) {
      return;
    }

    root.walkRules((rule) => {
      const unguarded =
        rule.selector.includes(":hover") && !hasHoverGuard(rule);
      if (unguarded) {
        report({
          message: messages.rejected,
          node: rule,
          result,
          ruleName,
          word: ":hover",
        });
      }
    });
  };
}

export const rule = Object.assign(checkHoverRules, { ruleName, messages });
