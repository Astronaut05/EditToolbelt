/**
 * Every server entry under /admin's gated group checks the admin itself
 * (docs/11 → Admin). The layout's check isn't enough: a client navigation can
 * render a page without its layout, and a server action never runs it. So each
 * page, layout, route handler and server action here starts with
 * `await requireAdmin()`, before it reads anything.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const GATED = fileURLToPath(new URL('.', import.meta.url));

/** Next's special files that run on the server for a request. */
const ENTRY = /^(page|layout|template|default|route)\.(\w+\.)?tsx?$/;

/** `await requireAdmin()`, alone or assigned. */
function isGate(statement: ts.Statement | undefined): boolean {
  if (!statement) return false;
  let expression: ts.Expression | undefined;
  if (ts.isExpressionStatement(statement)) expression = statement.expression;
  else if (ts.isVariableStatement(statement)) {
    const [only, ...rest] = statement.declarationList.declarations;
    if (rest.length === 0) expression = only?.initializer;
  }
  return Boolean(
    expression &&
    ts.isAwaitExpression(expression) &&
    ts.isCallExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === 'requireAdmin',
  );
}

const exported = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/**
 * For a Next entry or a server action file, what it exports that doesn't start
 * with the gate; null for any other file.
 */
function ungated(source: string, name: string): string[] | null {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const [first] = file.statements;
  const action =
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server';
  if (!action && !ENTRY.test(basename(name))) return null;
  const found: string[] = [];
  const unchecked = (what: string) => `${what} (write it as an async function)`;
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && exported(statement)) {
      if (!isGate(statement.body?.statements[0])) found.push(statement.name?.text ?? 'default');
    } else if (ts.isVariableStatement(statement) && exported(statement)) {
      // Constants (dynamic, metadata) are fine; a function must be a declaration, so it's checked.
      for (const { name: bound, initializer: value } of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(bound) ||
          (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)))
        ) {
          found.push(unchecked(bound.getText(file)));
        }
      }
    } else if (
      ts.isExportAssignment(statement) ||
      (ts.isExportDeclaration(statement) && !statement.isTypeOnly)
    ) {
      found.push(unchecked(statement.getText(file)));
    }
  }
  return found;
}

describe('the gated admin', () => {
  it('starts every page, layout, route and action with the admin check', () => {
    const checked: string[] = [];
    const missing: string[] = [];
    for (const path of readdirSync(GATED, { recursive: true, encoding: 'utf8' })) {
      if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) continue;
      const found = ungated(readFileSync(`${GATED}/${path}`, 'utf8'), path);
      if (!found) continue;
      checked.push(path);
      missing.push(...found.map((name) => `${path}: ${name}`));
    }
    // The walk found the files: a broken one would pass with nothing to check.
    expect(checked).toEqual(
      expect.arrayContaining([
        'layout.server.tsx',
        'page.server.tsx',
        'users/[id]/page.server.tsx',
        'users/[id]/data/route.server.ts',
        'actions.ts',
        'payments/actions.ts',
      ]),
    );
    expect(checked.length).toBeGreaterThanOrEqual(14);
    expect(missing).toEqual([]);
  });

  it('notices a page that reads before the check, or never checks', () => {
    const late =
      'export default async function P() { const rows = await db(); await requireAdmin(); return rows; }';
    expect(ungated(late, 'x/page.server.tsx')).toEqual(['P']);
    expect(ungated('export async function GET() { return new Response(); }', 'route.ts')).toEqual([
      'GET',
    ]);
    expect(ungated("'use server';\nexport const act = async () => {};", 'actions.ts')).toHaveLength(
      1,
    );
    const gated = `export const dynamic = 'force-dynamic';
      export default async function P() { const admin = await requireAdmin(); return admin; }`;
    expect(ungated(gated, 'page.server.tsx')).toEqual([]);
    // Neither a Next entry nor a server action: not this test's business.
    expect(ungated('export async function helper() {}', 'helpers.ts')).toBeNull();
  });
});
