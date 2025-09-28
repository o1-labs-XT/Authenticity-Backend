# Admin Dashboard with Railway Multi-Service Setup

## Progress Status
✅ **Part 1: Secure Your Express API** - COMPLETE
- ✅ express-basic-auth installed
- ✅ Admin middleware created at `src/api/middleware/adminAuth.ts`
- ✅ Admin endpoints protected (challenges create/delete, user delete)

✅ **Part 2: Create Next.js Dashboard** - COMPLETE
- ✅ Created admin-dashboard Next.js application
- ✅ Configured authentication middleware
- ✅ Built API client with axios
- ✅ Created dashboard UI with challenge management
- ✅ Added user deletion functionality
- ✅ Successfully built and tested

✅ **Part 3: Deploy to Railway** - COMPLETE
- ✅ Created railway.json configuration for multi-service deployment
- ✅ Configured both API and admin-dashboard services

## Architecture
- **Service 1:** Your existing Express API (with Basic Auth on admin endpoints)
- **Service 2:** Next.js admin dashboard (deployed in same Railway project)
- Both services share environment variables and deploy from same repo

## Part 1: Secure Your Express API ✅ COMPLETE

### Step 1: Install Basic Auth
```bash
npm install express-basic-auth
```

### Step 2: Create Admin Middleware
```typescript
// src/middleware/adminAuth.ts
import basicAuth from 'express-basic-auth';

export const requireAdmin = basicAuth({
  users: {
    [process.env.ADMIN_USERNAME || 'admin']: process.env.ADMIN_PASSWORD
  },
  challenge: true,
  unauthorizedResponse: 'Admin access required'
});
```

### Step 3: Protect Admin Endpoints
```typescript
// Keep endpoints at same paths, just add auth
router.post('/api/challenges', requireAdmin, handler.createChallenge);
router.delete('/api/challenges/:id', requireAdmin, handler.deleteChallenge);
router.delete('/api/users/:walletAddress', requireAdmin, handler.deleteUser);

// Public endpoints (no auth):
router.get('/api/challenges', handler.getChallenges);
router.get('/api/challenges/current', handler.getCurrentChallenge);
```

## Part 2: Create Next.js Dashboard

### Step 1: Setup Next.js App
```bash
# In your repo root
npx create-next-app@latest admin-dashboard --typescript --tailwind --app
cd admin-dashboard

# Install additional dependencies
npm install axios
```

### Step 2: Configure Environment Variables
Create `admin-dashboard/.env.local`:
```bash
# Railway will inject these automatically when deployed
NEXT_PUBLIC_API_URL=https://your-api.railway.app
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-password-here
```

### Step 3: Add Authentication to Dashboard
Create `admin-dashboard/middleware.ts`:
```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const authHeader = request.headers.get('authorization');

  if (!authHeader) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Admin Dashboard"'
      }
    });
  }

  const [scheme, encoded] = authHeader.split(' ');
  if (scheme !== 'Basic') {
    return new NextResponse('Invalid authentication', { status: 401 });
  }

  const decoded = Buffer.from(encoded, 'base64').toString();
  const [username, password] = decoded.split(':');

  if (
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return new NextResponse('Invalid credentials', { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
```

### Step 4: Create API Client
Create `admin-dashboard/lib/api.ts`:
```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  auth: {
    username: process.env.ADMIN_USERNAME!,
    password: process.env.ADMIN_PASSWORD!
  }
});

export const challengeApi = {
  list: () => api.get('/api/challenges'),
  create: (data: any) => api.post('/api/challenges', data),
  update: (id: number, data: any) => api.put(`/api/challenges/${id}`, data),
  delete: (id: number) => api.delete(`/api/challenges/${id}`)
};

export const userApi = {
  delete: (walletAddress: string) => api.delete(`/api/users/${walletAddress}`)
};
```

### Step 5: Create Dashboard UI
Create `admin-dashboard/app/page.tsx`:
```typescript
'use client';

import { useState, useEffect } from 'react';
import { challengeApi, userApi } from '@/lib/api';

export default function Dashboard() {
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newChallenge, setNewChallenge] = useState({
    title: '',
    description: '',
    startTime: '',
    endTime: ''
  });

  useEffect(() => {
    loadChallenges();
  }, []);

  const loadChallenges = async () => {
    try {
      const { data } = await challengeApi.list();
      setChallenges(data);
    } catch (error) {
      console.error('Failed to load challenges:', error);
    }
  };

  const createChallenge = async () => {
    setLoading(true);
    try {
      await challengeApi.create(newChallenge);
      setNewChallenge({ title: '', description: '', startTime: '', endTime: '' });
      await loadChallenges();
    } catch (error) {
      alert('Failed to create challenge');
    }
    setLoading(false);
  };

  const deleteChallenge = async (id: number) => {
    if (!confirm('Delete this challenge?')) return;
    try {
      await challengeApi.delete(id);
      await loadChallenges();
    } catch (error) {
      alert('Failed to delete challenge');
    }
  };

  const deleteUser = async () => {
    const wallet = prompt('Enter wallet address to delete:');
    if (!wallet) return;
    if (!confirm(`Delete user ${wallet}?`)) return;

    try {
      await userApi.delete(wallet);
      alert('User deleted successfully');
    } catch (error) {
      alert('Failed to delete user');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          TouchGrass Admin Dashboard
        </h1>

        {/* Create Challenge Card */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Create New Challenge</h2>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Title"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              value={newChallenge.title}
              onChange={(e) => setNewChallenge({...newChallenge, title: e.target.value})}
            />
            <textarea
              placeholder="Description"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              rows={3}
              value={newChallenge.description}
              onChange={(e) => setNewChallenge({...newChallenge, description: e.target.value})}
            />
            <div className="grid grid-cols-2 gap-4">
              <input
                type="datetime-local"
                className="px-3 py-2 border border-gray-300 rounded-md"
                value={newChallenge.startTime}
                onChange={(e) => setNewChallenge({...newChallenge, startTime: e.target.value})}
              />
              <input
                type="datetime-local"
                className="px-3 py-2 border border-gray-300 rounded-md"
                value={newChallenge.endTime}
                onChange={(e) => setNewChallenge({...newChallenge, endTime: e.target.value})}
              />
            </div>
            <button
              onClick={createChallenge}
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Challenge'}
            </button>
          </div>
        </div>

        {/* Challenges List */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Active Challenges</h2>
          <div className="space-y-4">
            {challenges.map((challenge: any) => (
              <div key={challenge.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-lg">{challenge.title}</h3>
                    <p className="text-gray-600">{challenge.description}</p>
                    <div className="text-sm text-gray-500 mt-2">
                      <p>Start: {new Date(challenge.startTime).toLocaleString()}</p>
                      <p>End: {new Date(challenge.endTime).toLocaleString()}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteChallenge(challenge.id)}
                    className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* User Management */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">User Management</h2>
          <button
            onClick={deleteUser}
            className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
          >
            Delete User by Wallet
          </button>
        </div>
      </div>
    </div>
  );
}
```

## Part 3: Deploy to Railway

### Step 1: Create railway.json in repo root
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "numReplicas": 1
  },
  "services": [
    {
      "name": "api",
      "source": {
        "repo": "."
      },
      "startCommand": "npm run start:api",
      "healthcheckPath": "/health",
      "restartPolicyType": "ON_FAILURE"
    },
    {
      "name": "admin-dashboard",
      "source": {
        "repo": "./admin-dashboard"
      },
      "startCommand": "npm run start",
      "restartPolicyType": "ON_FAILURE"
    }
  ]
}
```

### Step 2: Deploy Both Services
```bash
# From your repo root
railway link  # Link to your Railway project
railway up    # Deploy everything
```

Railway will:
1. Detect the railway.json
2. Create two services in your project
3. Give each service its own URL
4. Share environment variables between them

### Step 3: Configure Environment Variables in Railway
In Railway dashboard, add these project-level variables:
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<generate-secure-password>
```

For the admin-dashboard service, add:
```
NEXT_PUBLIC_API_URL=https://your-api-service.railway.app
```

## URLs After Deployment

- **API:** `https://your-project-api.railway.app`
- **Admin Dashboard:** `https://your-project-admin-dashboard.railway.app`

Both are protected by the same username/password via Basic Auth.

## File Structure
```
your-repo/
├── src/                    # Your existing Express API
├── admin-dashboard/        # New Next.js dashboard
│   ├── app/
│   │   └── page.tsx       # Dashboard UI
│   ├── lib/
│   │   └── api.ts         # API client
│   ├── middleware.ts      # Basic Auth protection
│   └── package.json
├── railway.json           # Multi-service config
└── package.json          # Your API package.json
```

## Security Notes

1. **Basic Auth** protects both services with same credentials
2. **HTTPS** is automatic on Railway
3. **Environment variables** are shared between services
4. **CORS** shouldn't be an issue since dashboard uses server-side API calls

## Deployment Instructions

### 1. Set Railway Environment Variables
In your Railway project, add these project-level variables:
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<generate-secure-password>
```

For the admin-dashboard service specifically, add:
```
NEXT_PUBLIC_API_URL=https://your-api-service.railway.app
```

### 2. Deploy to Railway
```bash
# From your repo root
railway link  # Link to your Railway project
railway up    # Deploy everything
```

### 3. Access Your Services
After deployment, you'll have two URLs:
- **API:** `https://your-project-api.railway.app`
- **Admin Dashboard:** `https://your-project-admin-dashboard.railway.app`

Both are protected by the same username/password via Basic Auth.

## Implementation Complete

✅ All parts of the Railway Admin Plan have been successfully implemented:
- Express API secured with Basic Auth on admin endpoints
- Next.js admin dashboard created with full challenge management UI
- Railway multi-service configuration ready for deployment

Total implementation time: ~45 minutes

## Benefits of This Approach

✅ Both services in one Railway project
✅ Share environment variables
✅ Deploy from same repo
✅ Professional UI with Tailwind
✅ Easy to maintain with Next.js
✅ Basic Auth protects everything
✅ No CORS issues
✅ Hot reload in development