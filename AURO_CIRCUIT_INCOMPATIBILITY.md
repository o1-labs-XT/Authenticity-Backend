# Auro Wallet Circuit Incompatibility Issue

## Executive Summary
Auro wallet integration is **fundamentally incompatible** with the current AuthenticityProof zkApp circuit.

## The Problem

### What Auro Signs
- **Message**: Raw SHA256 hex string
- **Example**: `"5c29e62db19bcba50e4d2e70ffe2fbf1f09d7b824a19ff368b3999ca7eb4d520"`
- **Format**: Plain text string

### What the Circuit Expects
- **Message**: Field representation of SHA256
- **Type**: o1js Field element derived from the SHA256
- **Format**: Field value (not the same as the hex string)

### Evidence From Testing
```
✅ Auro signature verification result: true (using mina-signer with hex)
❌ Constraint unsatisfied: Equal 0 1 (circuit signature check failed)
```

## Why This Cannot Be Fixed in Backend

The zkApp circuit at line 52 of AuthenticityProof.js performs:
```javascript
signature.verify(publicKey, expectedHash.toFields()).assertTrue()
```

This hardcoded check expects:
1. The signature to be on the Field representation
2. Not on the raw SHA256 hex string

Since we cannot change:
- What Auro signs (always signs raw strings)
- What the circuit verifies (hardcoded to expect Field)

**The incompatibility cannot be resolved without modifying the zkApp circuit itself.**

## Original Design Assumption
The original implementation assumed users would:
1. Use o1js to create signatures
2. Sign the Field representation: `Field(sha256).toFields()`
3. Send base58-encoded signatures

But Auro:
1. Uses mina-signer internally
2. Signs raw string data
3. Cannot be configured to sign Field representations

## Possible Solutions

### Option 1: Modify the zkApp Circuit (Recommended)
Change the AuthenticityProof circuit to accept signatures on raw SHA256 hex strings instead of Field representations.

### Option 2: Intermediate Signing Service
Create a service that:
1. Takes Auro's signature on the hex string
2. Uses a server-side key to sign the Field representation
3. Submits the server signature to the circuit

**Drawback**: Breaks the trust model - server could sign anything.

### Option 3: Different Wallet
Use a wallet that can sign Field representations directly.

**Drawback**: Limited wallet options, poor user experience.

## Conclusion
The current approach of trying to make Auro signatures work with the existing circuit is **impossible** due to the fundamental difference in what is being signed.