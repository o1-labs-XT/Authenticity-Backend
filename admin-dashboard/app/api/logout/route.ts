import { NextResponse } from 'next/server';

export async function POST() {
  return new NextResponse('Logged out', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Admin Dashboard"',
    },
  });
}
