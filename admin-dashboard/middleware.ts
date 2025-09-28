import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const authHeader = request.headers.get('authorization');

  if (!authHeader) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Admin Dashboard"',
      },
    });
  }

  const [scheme, encoded] = authHeader.split(' ');
  if (scheme !== 'Basic') {
    return new NextResponse('Invalid authentication', { status: 401 });
  }

  const decoded = Buffer.from(encoded, 'base64').toString();
  const [username, password] = decoded.split(':');

  // For local development, use hardcoded values
  // In production, these would come from environment variables
  const expectedUsername = 'admin';
  const expectedPassword = 'pass';

  if (username !== expectedUsername || password !== expectedPassword) {
    return new NextResponse('Invalid credentials', { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
