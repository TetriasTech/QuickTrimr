import { dirname, isAbsolute, relative, resolve } from 'node:path';

// no-restricted-imports handles static specifiers. Resolve local paths as well so
// ../ escapes, dynamic imports, require and re-exports cannot bypass the boundary.
export function boundaryPlugin(root) {
  const inside = (file, directory) => {
    const path = relative(directory, file);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path));
  };
  return {
    rules: {
      imports: {
        meta: {
          type: 'problem',
          schema: [],
          messages: {
            boundary:
              'ADR-007: {{source}} crosses a workspace boundary; use an allowed shared package.',
            dynamic:
              'Use a literal module specifier so workspace boundaries can be checked.',
          },
        },
        create(context) {
          const filename = context.filename;
          const projectPath = relative(root, filename).replaceAll('\\', '/');
          const app = projectPath.match(/^apps\/([^/]+)\//)?.[1];
          const domain = projectPath.startsWith('packages/domain/src/');
          const shared = projectPath.startsWith('packages/shared/src/');
          const packaged = projectPath.startsWith('packages/');
          if (
            !app &&
            !packaged &&
            !projectPath.startsWith('supabase/functions/')
          )
            return {};

          function check(node, sourceNode) {
            if (!sourceNode || typeof sourceNode.value !== 'string') {
              context.report({ node, messageId: 'dynamic' });
              return;
            }
            const source = sourceNode.value;
            let target;
            if (source.startsWith('.'))
              target = resolve(dirname(filename), source);
            else if (isAbsolute(source)) target = source;
            else if (source.startsWith('@/') && app)
              target = resolve(root, 'apps', app, 'src', source.slice(2));
            else if (source.startsWith('@quicktrimr/')) {
              const name = source.split('/')[1];
              target = resolve(
                root,
                ['mobile', 'admin'].includes(name) ? 'apps' : 'packages',
                name,
                ...source.split('/').slice(2),
              );
            }
            let forbidden = /^@quicktrimr\/(mobile|admin)(\/|$)/.test(source);
            if (target && inside(target, resolve(root, 'apps'))) {
              forbidden ||= !app || !inside(target, resolve(root, 'apps', app));
            }
            if (domain || shared) {
              const own = resolve(
                root,
                'packages',
                domain ? 'domain' : 'shared',
                'src',
              );
              const allowedShared =
                domain &&
                (source === '@quicktrimr/shared' ||
                  (target &&
                    inside(target, resolve(root, 'packages/shared/src'))));
              forbidden ||= !allowedShared && (!target || !inside(target, own));
            }
            if (forbidden)
              context.report({ node, messageId: 'boundary', data: { source } });
          }
          return {
            ImportDeclaration: (node) => check(node, node.source),
            ExportNamedDeclaration: (node) => {
              if (node.source) check(node, node.source);
            },
            ExportAllDeclaration: (node) => check(node, node.source),
            ImportExpression: (node) => check(node, node.source),
            TSImportEqualsDeclaration: (node) => {
              if (node.moduleReference.type === 'TSExternalModuleReference')
                check(node, node.moduleReference.expression);
            },
            CallExpression: (node) => {
              if (
                node.callee.type === 'Identifier' &&
                node.callee.name === 'require'
              )
                check(node, node.arguments[0]);
            },
          };
        },
      },
    },
  };
}
