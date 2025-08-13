# Provenance Backend API Test Requests

This document contains curl commands to test all API endpoints in the Provenance Backend service.

## Health & Info Endpoints

### Health Check
```bash
curl -X GET http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-13T12:00:00.000Z",
  "uptime": 12345,
  "environment": "development"
}
```

### API Version
```bash
curl -X GET http://localhost:3000/api/version
```

Expected response:
```json
{
  "version": "1.0.0",
  "api": "Provenance Backend API",
  "zkApp": "B62qp..."
}
```

## Main API Endpoints

### 1. Upload Image with Signature
**POST /api/upload**

This endpoint requires multipart form data with an image file, public key, and signature.

```bash
# Example with test data
curl -X POST http://localhost:3000/api/upload \
  -F "image=@/Users/hattyhattington/Desktop/demo.png" \
  -F "publicKey=B62qr4GMWoMvLmBroLYwmdhwvJEshZZPDrK8HhT9SgHuYYLMCCfX1C6" \
  -F "signature=7mXGPCbSJNQGaFnCRx8pBR9dLGcF1qthPwnqX8eJCrJV4ZJw5mUURoXLdqFWZjN4EQzT5vz3n4Kx4iJvKAHzTBzW5WYrNKbn"
```

Note: Replace the following:
- `/path/to/your/image.jpg` with the actual path to an image file
- `publicKey` with a valid Base58 encoded Mina public key
- `signature` with a valid Base58 encoded signature of the image's SHA256 hash

Expected response (success):
```json
{
  "tokenOwnerAddress": "B62qr4GMWoMvLmBroLYwmdhwvJEshZZPDrK8HhT9SgHuYYLMCCfX1C6",
  "sha256Hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "status": "pending"
}
```

Expected response (duplicate):
```json
{
  "tokenOwnerAddress": "B62qr4GMWoMvLmBroLYwmdhwvJEshZZPDrK8HhT9SgHuYYLMCCfX1C6",
  "status": "duplicate"
}
```

### 2. Get Proof Generation Status
**GET /api/status/:sha256Hash**

```bash
# Replace with actual SHA256 hash from upload response
curl -X GET http://localhost:3000/api/status/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

Expected response (pending):
```json
{
  "status": "pending",
  "tokenOwnerAddress": "B62qr4GMWoMvLmBroLYwmdhwvJEshZZPDrK8HhT9SgHuYYLMCCfX1C6"
}
```

Expected response (verified):
```json
{
  "status": "verified",
  "tokenOwnerAddress": "B62qr4GMWoMvLmBroLYwmdhwvJEshZZPDrK8HhT9SgHuYYLMCCfX1C6",
  "transactionId": "CkpYj..."
}
```

Expected response (failed):
```json
{
  "status": "failed",
  "tokenOwnerAddress": "B62qr4GMWoMvLmBroLYwmdhwvJEshZZPDrK8HhT9SgHuYYLMCCfX1C6",
  "errorMessage": "Failed to generate proof: ..."
}
```

### 3. Get Statistics
**GET /api/statistics**

```bash
curl -X GET http://localhost:3000/api/statistics
```

Expected response:
```json
{
  "total": 100,
  "pending": 10,
  "verified": 85,
  "failed": 5
}
```

### 4. Get Token Owner for Image
**GET /api/token-owner/:sha256Hash**

```bash
# Replace with actual SHA256 hash
curl -X GET http://localhost:3000/api/token-owner/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

Expected response (found):
```json
{
  "tokenOwnerAddress": "B62qr4GMWoMvLmBroLYwmdhwvJEshZZPDrK8HhT9SgHuYYLMCCfX1C6",
  "status": "verified",
  "found": true
}
```

Expected response (not found):
```json
{
  "found": false
}
```

## Error Testing

### Test File Size Limit
```bash
# Create a large file (11MB) to test upload limit
dd if=/dev/zero of=large_file.jpg bs=1M count=11

curl -X POST http://localhost:3000/api/upload \
  -F "image=@large_file.jpg" \
  -F "publicKey=B62qr4GMWoMvLmBroLYwmdhwvJEshZZPDrK8HhT9SgHuYYLMCCfX1C6" \
  -F "signature=test_signature"

# Clean up
rm large_file.jpg
```

Expected response:
```json
{
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "File size exceeds limit of 10MB",
    "field": "image"
  }
}
```

### Test Invalid File Type
```bash
# Create a text file to test file type validation
echo "test" > test.txt

curl -X POST http://localhost:3000/api/upload \
  -F "image=@test.txt" \
  -F "publicKey=B62qr4GMWoMvLmBroLYwmdhwvJEshZZPDrK8HhT9SgHuYYLMCCfX1C6" \
  -F "signature=test_signature"

# Clean up
rm test.txt
```

Expected response:
```json
{
  "error": {
    "code": "UPLOAD_ERROR",
    "message": "Invalid file type. Allowed types: image/jpeg, image/jpg, image/png, image/gif, image/webp"
  }
}
```

### Test Invalid SHA256 Hash Format
```bash
curl -X GET http://localhost:3000/api/status/invalid_hash
```

Expected response:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid SHA256 hash format"
  }
}
```

### Test 404 Endpoint
```bash
curl -X GET http://localhost:3000/api/nonexistent
```

Expected response:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Cannot GET /api/nonexistent"
  }
}
```

## Testing with Real Images

### Generate Test Image and Signature (Example using Node.js)

Create a file `generate-test-data.js`:

```javascript
const crypto = require('crypto');
const fs = require('fs');

// Read image file
const imagePath = './test-image.jpg';
const imageBuffer = fs.readFileSync(imagePath);

// Calculate SHA256 hash
const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
console.log('SHA256 Hash:', hash);

// For testing, you would need to sign this hash with a Mina private key
// This requires the Mina SDK or compatible signing library
console.log('Use this hash to generate a signature with your Mina wallet');
```

## Environment Variables for Testing

Make sure these environment variables are set when running the server:

```bash
# Server configuration
PORT=3000
NODE_ENV=development

# CORS configuration (optional, defaults to *)
CORS_ORIGIN=http://localhost:3001

# Upload limits
UPLOAD_MAX_SIZE=10485760  # 10MB in bytes

# Database
DATABASE_URL=sqlite://provenance.db

# zkApp configuration
ZKAPP_ADDRESS=B62qp...  # Your zkApp address
MINA_NETWORK=testnet    # or mainnet
```

## Notes

1. **Authentication**: These endpoints don't require authentication tokens, but signature verification happens server-side.

2. **Rate Limiting**: If rate limiting is implemented, you may need to add delays between requests.

3. **File Cleanup**: Uploaded files are stored in `/tmp` and should be cleaned up automatically after processing.

4. **Polling Status**: When checking proof generation status, implement exponential backoff:
   - Initial poll: immediately after upload
   - Subsequent polls: 2s, 4s, 8s, 16s, 32s, then every 30s

5. **Testing with Docker**: If running in Docker, replace `localhost:3000` with the appropriate Docker container address.

## Quick Test Script

Save this as `test-api.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:3000"

echo "Testing Health Endpoint..."
curl -s "$BASE_URL/health" | jq '.'

echo -e "\nTesting Version Endpoint..."
curl -s "$BASE_URL/api/version" | jq '.'

echo -e "\nTesting Statistics Endpoint..."
curl -s "$BASE_URL/api/statistics" | jq '.'

echo -e "\nTesting Invalid Endpoint (404)..."
curl -s "$BASE_URL/api/invalid" | jq '.'

echo -e "\nAll basic tests completed!"
```

Make it executable and run:
```bash
chmod +x test-api.sh
./test-api.sh
```
