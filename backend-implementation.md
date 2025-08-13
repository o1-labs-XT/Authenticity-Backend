Backend handles image uploads, generates zero-knowledge proofs of authenticity, manages on-chain token account deployments, and provides APIs for both provers (image uploaders) and verifiers (image viewers).

- Project structure is REST API -> Handlers -> Services -> DB
- Provers upload images and receive a randomly generated token owner address immediately
- Backend generates proof and deploys token account on-chain asynchronously
- Verifiers query backend for token owner address, then query blockchain directly for token account state

# REST Endpoints

## Prover

### Upload

- POST `/api/upload`
- Accepts: multipart/form-data with image, publicKey, signature
- Returns: Randomly generated token owner address

```jsx
{ tokenOwner: string }
```

- Triggers async proof generation and publishing

### Status

- GET `/api/status/:sha256Hash`
- Returns: Current status of proof generation for the image with the given commitment and the associated token owner

```jsx
{ status: "pending" | "published", tokenOwner: string }
```

- UI can poll this endpoint to check if proof generation is complete

## Verifier

### Get Token Owner Address

- GET `/api/token-owner/:sha256Hash`
    - Returns token owner address
    
    ```jsx
    { tokenOwner: string }
    ```
    
    - Used in verification flow - verification occurs client side using token owner address

# Handlers

### Upload Handler

- Receive `image`, `publicKey`, `signature` from request
- Convert img to bytes
- Compute SHA256 hash
- Check database for existing record of image hash
    - If exists return associated token owner address
- Run `prepareImageVerification` to compute
    - Expected hash of the image
    - Internal SHA256 state one round before completion
- Verify expected hash matches supplied signature
    - do this outside of circuit for performance
- Generate random `tokenOwnerAddress`
- Insert pending proof record in database with
    - SHA256 commitment
    - Token owner address
    - pending status
    - Queryable via `/api/status/:sha256Hash
- Return `tokenOwnerAddress` to user
- Trigger proof generation service
    - can be a direct call for MVP but this should be behind a queue

### Status Handler

- Receive SHA256 commitment as parameter
- Query database for matching record
- Return verification status

### Token Owner Handler

- Receive SHA256 hash as parameter
- Query database for token owner address
- Return address if found

# Services

## ZK Service

### Generate Authenticity Proof

- Receives a proof task (will read from queue)

```tsx
interface ProofTask {
  tokenOwnerAddress: string;
  authenticityInputs: {
    publicKey: PublicKey;
    signature: Signature;
    commitment: Field;  // SHA256 hash
  };
  finalRoundInputs: {
    state: Field[];         // SHA256 state after round 62
    initialState: Field[];  // Initial SHA256 state (H0-H7)
    messageWord: Field;     // W_t for final round
    roundConstant: Field;   // K_t for final round
  };
}

```

- Run `AuthenticityProgram.verifyAuthenticity` to generate a proof that
    - Penultimate SHA256 state produces signed hash after final round
    - Signature was made with provided key on expected SHA256 commitment
- Trigger publishing proof of authenticity

### Publish Proof of Authenticity

- Receive publish task

```tsx
interface PublishTask {
  proof: AuthenticityProof;
  tokenOwnerAddress: string;
  authenticityInputs: AuthenticityInputs;
}

```

- Call deployed `AuthenticityZkApp.verifyAndStore` which
    - Verifies the `AuthenticityProgram` proof
    - Deploys token account with state storing:
        - Poseidon hash of image commitment
        - Two fields for creator public key (x coordinate and isOdd)
- Update database record associated with commitment from "pending" to "verified"

# Database

- Records will be indexed by sha256 commitment and have a tokenOwnerAddress and status
- Error handling logic will delete records associated with failed verifications

# Error Handling

- Error handling logic will delete records associated with failed verifications, pending means that a commitment is on its way to having a record of authenticity published

# Queueing

- Proof generation and publishing will become bottlenecks in a production system
