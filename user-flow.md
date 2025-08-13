## User Flow
This document describes the complete user flow for the image authenticity verification system built on Mina Protocol. The system enables creators (provers) to generate zero-knowledge proofs of image authenticity and allows anyone (verifiers) to verify the authenticity of images on-chain.
## System Setup
### Pre-deployment
- **AuthenticityZkApp** instance is deployed by the system administrators in advance
	- This contract serves as the main verification and storage mechanism for all authenticity proofs
- The backend is configured with the deployed contract address
## Prover Flow (Image Creator)
### Client-Side Operations
1. **Image Selection**
    - Alice selects an image she wants to prove authenticity for
    - The image file is loaded into the browser
2. **Commitment Generation**
    - The browser computes the SHA256 hash of the selected image
    - This hash serves as a cryptographic commitment to the image content
3. **Signature Creation**
    - Alice signs the SHA256 commitment using her Mina private key
    - This signature proves Alice's ownership/creation of the image
4. **Upload to Backend**
    - Alice uploads the following to the backend via `POST /api/upload`:
        - The original image file
        - Her public key
        - The signature of the SHA256 commitment
    - Alice receives a randomly generated token owner address immediately which can be used to look up the proof of authenticity for the image once it has been published
	    - computing and publishing the proof is time consuming so we trigger the proof generation process and then return the token owner address immediately
5. Polling
	- UI polls the backend at `GET /api/status/:sha256Hash` until the proof has been published on chain or if an error has occurred`
	- Returns current status: "pending" or "published"
	- Includes the associated token owner address
	- UI updates itself accordingly
### Backend Processing
1. **Duplicate Check**
    - Backend checks if an image with the same SHA256 hash already exists
    - If duplicate found, returns the existing token owner address
2. **Image Verification Preparation**
    - Backend runs `prepareImageVerification` to compute:
        - Expected SHA256 hash of the uploaded image
        - Internal SHA256 state one round before completion (round 62 state)
3. **Signature Verification**
    - Backend verifies that the computed hash matches what Alice signed
    - This ensures the uploaded image matches the signed commitment
4. **Zero-Knowledge Proof Generation**
    - Backend executes `AuthenticityProgram.verifyAuthenticity` ZkProgram
    - This generates a proof that:
        - The penultimate SHA256 state correctly produces Alice's signed hash after the final round
        - The supplied signature was made with Alice's key on the supplied SHA256 commitment
5. **On-Chain Storage**
    - Backend calls `AuthenticityZkApp.verifyAndStore` which:
        - Verifies the `AuthenticityProgram` proof
        - Deploys a token account with state storing:
            - Poseidon hash of the image commitment
            - Two fields representing the creator public key (x coordinate and isOdd boolean)
6. **Backend Storage**
    - Backend stores mapping: SHA256 commitment to the image → token owner address
    - Updates status from "pending" to "published"
    - Makes this data available via REST API endpoints

## Verifier Flow (Anyone Checking Authenticity)

### Client-Side Verification Process

1. **Image Hash Computation**
    - Verifier has an image and wants to verify the creator address of that image
    - Browser computes the SHA256 hash of the image
2. **Token Account Discovery**
    - Verifier queries backend endpoint `GET /api/token-owner/:sha256Hash`
    - Receives the token owner account address associated with the image (if it exists)
	    - If it does not exist, ui displays that the image has not been verified on chain
3. **On-Chain State Reading**
    - Verifier reads state directly from the token account on Mina blockchain
    - Retrieves:
        - Poseidon hash of the SHA256 commitment
        - Creator's public key components (x coordinate and isOdd)
4. **Verification Checks**
    - **Hash Verification**:
        - Computes Poseidon hash of the image's SHA256 hash
        - Verifies it matches the on-chain stored Poseidon hash
    - **Creator Reconstruction**:
        - Reconstructs the full creator public key from x coordinate and isOdd values
        - This identifies who originally created/signed the image
5. **Result Interpretation**
    - If all checks pass: Image is authentic and created by the identified public key
    - If any check fails: Image authenticity cannot be verified

## Properties
- **Non-Interactive Verification**: Once published, anyone can verify image authenticity without interacting with the original creator
- **Immutable Proof**: The on-chain token account provides permanent, tamper-proof record of authenticity
- **Privacy Preserving**: Only the commitment hash is stored on-chain, not the image itself
- **Decentralized Trust**: Verification happens directly on Mina blockchain, no trust in backend required for verification
