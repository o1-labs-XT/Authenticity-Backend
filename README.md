# Provenance Backend

Zero-knowledge proof-based image authenticity verification backend for Project Tapestry.

## Features

- Image upload with SHA256 commitment
- Zero-knowledge proof generation using Mina Protocol
- On-chain authenticity verification
- Token account deployment for image records
- REST API for provers and verifiers

## Prerequisites

- Node.js 18.14.0+
- npm or yarn
- Access to Mina testnet

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd provenance-backend
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

## Development

Run in development mode with hot reload:
```bash
npm run dev
```

## Build

Build for production:
```bash
npm run build
```

## Production

Start production server:
```bash
npm start
```

## API Endpoints

### Prover Endpoints

- `POST /api/upload` - Upload image with signature
- `GET /api/status/:sha256Hash` - Check proof generation status

### Verifier Endpoints

- `GET /api/token-owner/:sha256Hash` - Get token owner address for image

## Project Structure

```
src/
├── api/          # Express routes and middleware
├── handlers/     # Request handlers
├── services/     # Business logic
│   ├── zk/       # Zero-knowledge proof services
│   ├── image/    # Image processing
│   └── queue/    # Task queue management
├── db/           # Database layer
├── types/        # TypeScript definitions
└── utils/        # Utility functions
```

## Testing

Run tests:
```bash
npm test
```

## License

ISC