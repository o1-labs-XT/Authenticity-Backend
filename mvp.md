# Questions
- will authentication be wallet based? Will there even be authentication or can the user just sign txs with their wallet and request public data for their address?
# Summary

**App Name:** TouchGrass MVP

## Pages

- Dashboard (Current Challenge & Chain Preview)
- Chain Detail
- User Detail
- Image Upload

## APIs

- `/api/users/{walletAddress}`
    - Manages users of the system, used for accessing metadata about the user
    - GET, POST - Create and read users
- `/api/challenges`
    - Returns metadata about challenges
    - GET only - admins manage challenge creation and edits
- `/api/chains`
    - Returns metadata about the existing chains
    - GET only for reading chain metadata. Chains are automatically created when a new challenge launches.
- `/api/submissions`
    - Manages submissions, which are tied to a specific user-challenge combination
    - GET and POST, for reading existing submissions and creating new ones. Existing submissions can't be modified or deleted.

# Navigation

- Wallet address display (shortened) in top right corner
- GET `/api/users/{walletAddress}`
- Clicking takes user to their profile/history page
- Disconnect wallet option in dropdown (clears localStorage)
- note - image publishing will require signatures

# Dashboard

## Current challenge

- Displays the current challenge
    - Challenge title and description
    - Number of participants
    - Time remaining (countdown timer)
- GET `/api/challenges/current`
    - Returns: `Challenge`
- Shows user's submission if exists
    - GET `/api/submissions`
        - filter by current `walletAddress` and `challengeId`
        - Returns: `{ submission?: Submission }`
    - If user already submitted, display
        - Image
        - Current position in chain
        - "View Chain" button
    - If not submitted:
        - Show CTA to participate
- Clicking the challenge takes you to the chain detail for the only chain for the challenge in mvp

# Photo Submission Flow

- POST `/api/submissions`
    - Multipart form data:
        - `image` - Image file (required)
        - `publicKey` - Signer's public key in base58 (required)
        - `signature` - Signature of image hash in base58 (required)
        - `walletAddress` - User's wallet address (required)
        - `tagline` - Optional tagline for the submission
    - Signature must be created client-side using o1js:
        - Hash the image with SHA256
        - Sign the hash with user's private key
        - Send publicKey and signature in base58 format
- Server processing:
    - Validates signature against image hash
    - Checks for duplicate images (by SHA256)
    - Checks if user already submitted for current challenge
    - Stores image in MinIO for worker access
    - Creates submission record with initial status
    - Enqueues proof generation job for worker
    - Returns submission with tokenOwnerAddress immediately
- Progress states (tracked via status field):
    - "uploading" - Initial state when created
    - "proving" - Worker is generating ZK proof
    - "publishing" - Worker is publishing to blockchain
    - "verifying" - Awaiting blockchain confirmation
    - "verified" - Complete with transaction ID
    - "failed" - Proof generation failed after retries
- On successful submission, redirect to chain detail view

# Chain Detail View

- "Default" as title
- Back arrow to dashboard
- GET `/api/chains/{id}`
    - Returns: `Chain`
- Display metrics:
    - Total images in chain
    - Age (time since challenge started)
- Extend Chain CTA
    - Redirects to submission flow
    - Disabled if user already submitted
- GET `/api/submissions`
    - Request params: `{ chainId: number, page: number, limit: number }`
    - Returns: `{ submissions: Submission[] }`
- Each image shows:
    - Wallet address (shortened)
    - Time posted
    - Image
    - Tagline 
    - Position in chain

# User Profile/History Page

- GET `/api/users/{walletAddress}`
    - Returns: `{ user: User }`
- Wallet address display
- Member since date

### My Submissions Gallery

- GET `/api/submissions`
    - Request params: `{ walletAddress: string, page: number, limit: number }`
    - Returns: `{ submissions: Submission[] }`
- Each submission shows:
    - Image
    - Challenge name/date
    - Time posted
    - Position in chain
- Clicking image opens detail modal

# Image Detail View

- GET `/api/submissions/{submissionId}`
- Full-size image view
- Position in chain
- Tagline
- "View Chain" button to navigate to chain detail page

# Admin View

- requires o1labs authentication against the server, can be hardcoded admin credentials
- not part of the app
- View all images in S3 with the associated challenge
    - assumes that if an image is in s3 it's been authed on chain
- buttons to approve or reject image based on challenge criteria
- triggers flow for server to update the on chain record to `challengeVerified=true` using its admin key

---

# Models

```tsx
interface User {
  id: string;
  walletAddress: string;
  createdAt: Date;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  participantCount: number;
  chainCount: number; // always 1 for mvp
}

interface Submission {
  id: string;
  sha256Hash: string; // Links to proof generation
  tokenOwnerAddress: string; // Random address for token ownership
  walletAddress: string; // User's wallet address
  publicKey: string; // Signer's public key
  signature: string; // Image signature
  challengeId: string;
  chainId: string;
  imageUrl: string; // MinIO storage URL (generated after upload)
  tagline: string;
  chainPosition: number;
  status: 'pending' | 'proving' | 'awaiting_confirmation' | 'verified' | 'failed';
  transactionId?: string; // Mina blockchain transaction ID when verified
  createdAt: Date;
}

interface Chain {
  id: string;
  name: string;
  challengeId: string;
  length: number;
  createdAt: Date;
  lastActivityAt: Date;
}
```