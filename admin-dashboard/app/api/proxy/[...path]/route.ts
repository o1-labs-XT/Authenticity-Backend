import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const API_KEY = process.env.BACKEND_API_KEY;
const AUTH = API_KEY ? Buffer.from(API_KEY).toString('base64') : undefined;

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const url = `${API_URL}/api/${path}${request.nextUrl.search}`;

  const headers: HeadersInit = {};
  if (AUTH) {
    headers.Authorization = `Basic ${AUTH}`;
  }

  const response = await fetch(url, { headers });

  // Handle image responses (binary data)
  const contentType = response.headers.get('content-type');
  if (contentType?.startsWith('image/')) {
    const imageBuffer = await response.arrayBuffer();
    return new NextResponse(imageBuffer, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': response.headers.get('cache-control') || 'public, max-age=3600',
      },
    });
  }

  // Handle JSON responses
  const data = await response.json().catch(() => ({ error: response.statusText }));
  return NextResponse.json(data, { status: response.status });
}

export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const url = `${API_URL}/api/${path}`;

  const contentType = request.headers.get('content-type');
  const headers: HeadersInit = {};

  if (AUTH) {
    headers.Authorization = `Basic ${AUTH}`;
  }

  let body;

  // Handle multipart/form-data (file uploads)
  if (contentType?.includes('multipart/form-data')) {
    body = await request.formData();
  } else {
    // Handle JSON
    headers['Content-Type'] = 'application/json';
    const jsonBody = await request.json();
    body = JSON.stringify(jsonBody);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  const data = await response.json().catch(() => ({ error: response.statusText }));
  return NextResponse.json(data, { status: response.status });
}

export async function PATCH(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const url = `${API_URL}/api/${path}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (AUTH) {
    headers.Authorization = `Basic ${AUTH}`;
  }

  const jsonBody = await request.json();
  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(jsonBody),
  });

  const data = await response.json().catch(() => ({ error: response.statusText }));
  return NextResponse.json(data, { status: response.status });
}

export async function DELETE(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const url = `${API_URL}/api/${path}`;

  const headers: HeadersInit = {};
  if (AUTH) {
    headers.Authorization = `Basic ${AUTH}`;
  }

  const response = await fetch(url, {
    method: 'DELETE',
    headers,
  });

  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = await response.json().catch(() => ({ error: response.statusText }));
  return NextResponse.json(data, { status: response.status });
}
