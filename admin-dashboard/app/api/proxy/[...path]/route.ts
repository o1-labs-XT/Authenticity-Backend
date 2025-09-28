import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const API_KEY = process.env.BACKEND_API_KEY;
const AUTH = API_KEY ? Buffer.from(API_KEY).toString('base64') : undefined;

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const url = `${API_URL}/api/${path}${request.nextUrl.search}`;

  try {
    const headers: HeadersInit = {};
    if (AUTH) {
      headers.Authorization = `Basic ${AUTH}`;
    }

    const response = await fetch(url, { headers });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const url = `${API_URL}/api/${path}`;
  const body = await request.json();

  try {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (AUTH) {
      headers.Authorization = `Basic ${AUTH}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create resource' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const url = `${API_URL}/api/${path}`;

  try {
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

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete resource' }, { status: 500 });
  }
}
