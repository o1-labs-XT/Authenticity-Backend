import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export async function POST(request: NextRequest) {
  let tempFilePath: string | undefined;

  try {
    const formData = await request.formData();
    const file = formData.get('image') as File;

    if (!file) {
      return NextResponse.json(
        { error: { message: 'No image file provided', field: 'image' } },
        { status: 400 }
      );
    }

    // Get the fixed signer private key from environment
    const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY;
    if (!signerPrivateKey) {
      console.error('SIGNER_PRIVATE_KEY not configured');
      return NextResponse.json(
        { error: { message: 'Server configuration error: SIGNER_PRIVATE_KEY not set' } },
        { status: 500 }
      );
    }

    // Read image buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Write to temp file (prepareImageVerification requires file path)
    tempFilePath = join(
      tmpdir(),
      `credential-gen-${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
    writeFileSync(tempFilePath, buffer);

    // Dynamic import to avoid top-level await issues with o1js and authenticity-zkapp
    const [{ PrivateKey }, { prepareImageVerification, Ecdsa, Secp256r1 }] = await Promise.all([
      import('o1js'),
      import('authenticity-zkapp'),
    ]);

    // Use the same verification preparation as backend
    const verificationInputs = prepareImageVerification(tempFilePath);

    // Create ECDSA signature using the FIXED private key from env
    const creatorKey = Secp256r1.Scalar.from(BigInt(signerPrivateKey));
    const signature = Ecdsa.signHash(verificationInputs.expectedHash, creatorKey.toBigInt());

    // Extract signature components as hex strings (64 chars each)
    const signatureData = signature.toBigInt();
    const signatureR = signatureData.r.toString(16).padStart(64, '0');
    const signatureS = signatureData.s.toString(16).padStart(64, '0');

    // Generate a random Mina wallet address for the submission
    const privateKey = PrivateKey.random();
    const publicKey = privateKey.toPublicKey();
    const walletAddress = publicKey.toBase58();

    return NextResponse.json({
      walletAddress,
      signatureR,
      signatureS,
    });
  } catch (error: any) {
    console.error('Failed to generate test credentials:', error);
    return NextResponse.json(
      { error: { message: error.message || 'Failed to generate credentials' } },
      { status: 500 }
    );
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      try {
        unlinkSync(tempFilePath);
      } catch (err) {
        console.error('Failed to delete temp file:', err);
      }
    }
  }
}
