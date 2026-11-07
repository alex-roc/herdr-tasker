// Resolve hook: Herdr's built-in modules → the fakes in test/stubs.
const STUBS = { herdr: "herdr.js", "gpui-kit": "gpui-kit.js", "gpui-base": "gpui-base.js" };

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: new URL(`./stubs/${STUBS[specifier]}`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
