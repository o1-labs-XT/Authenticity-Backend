import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// protects nextjs routes
export function middleware(request: NextRequest) {
  const authHeader = request.headers.get('authorization');

  // Check for missing auth header
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Admin Dashboard"' },
    });
  }

  // Decode credentials
  try {
    const base64 = authHeader.slice(6); // Remove 'Basic '
    const [username, password] = Buffer.from(base64, 'base64').toString().split(':');

    // Validate credentials
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
      return NextResponse.next();
    }
  } catch {
    // Malformed auth header
  }

  return new NextResponse('Invalid credentials', { status: 401 });
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
