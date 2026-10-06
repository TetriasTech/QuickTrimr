import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep ordinary app code on its typed accessor. In particular, no dynamic
// process.env[name], aliasing, destructuring or spreading of the environment.
export function clientEnvironmentPlugin(root) {
  const readers = new Map(
    ['mobile', 'admin'].map((app) => [
      resolve(root, `apps/${app}/src/lib/env.ts`),
      new Set(
        [
          ...readFileSync(
            resolve(root, `apps/${app}/.env.example`),
            'utf8',
          ).matchAll(/^([A-Z_]+)=/gm),
        ].map((match) => match[1]),
      ),
    ]),
  );
  return {
    rules: {
      'typed-accessor': {
        meta: {
          type: 'problem',
          schema: [],
          messages: {
            boundary:
              'P0-T03: use the app typed env accessor; only its static public reads are permitted.',
          },
        },
        create(context) {
          const file = resolve(context.filename);
          return {
            Identifier(node) {
              if (node.name !== 'process') return;
              // Ignore property names, not references (for example an object field named process).
              if (
                node.parent.type === 'MemberExpression' &&
                node.parent.property === node &&
                !node.parent.computed
              )
                return;
              if (
                node.parent.type === 'Property' &&
                node.parent.key === node &&
                !node.parent.shorthand &&
                !node.parent.computed
              )
                return;
              const env = node.parent;
              const read = env.parent;
              const staticRead =
                env.type === 'MemberExpression' &&
                env.object === node &&
                !env.computed &&
                env.property.name === 'env' &&
                read.type === 'MemberExpression' &&
                read.object === env &&
                !read.computed &&
                read.property.type === 'Identifier';
              if (staticRead && readers.get(file)?.has(read.property.name))
                return;
              if (
                staticRead &&
                file === resolve(root, 'apps/admin/playwright.config.ts') &&
                read.property.name === 'CI'
              )
                return;
              context.report({ node, messageId: 'boundary' });
            },
          };
        },
      },
    },
  };
}
