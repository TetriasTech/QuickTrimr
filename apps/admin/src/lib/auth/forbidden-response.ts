import { NextResponse } from 'next/server';

const forbiddenPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Admin access required · QuickTrimr</title>
  </head>
  <body>
    <main>
      <h1>Admin access required</h1>
      <p>This workspace is restricted to authorised administrators.</p>
      <a href="/login">Return to sign in</a>
    </main>
  </body>
</html>`;

export function forbiddenResponse() {
  return new NextResponse(forbiddenPage, {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}
