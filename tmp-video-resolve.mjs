import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
    const target = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (existsSync(target)) return nextResolve(target.href, context);
  }
  return nextResolve(specifier, context);
} });
