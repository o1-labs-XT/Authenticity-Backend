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
    const [{ PrivateKey, Signature }, { prepareImageVerification }] = await Promise.all([
      import('o1js'),
      import('authenticity-zkapp'),
    ]);

    // Use the same verification preparation as backend
    const verificationInputs = prepareImageVerification(tempFilePath);

    // Generate random keypair
    const privateKey = PrivateKey.random();
    const publicKey = privateKey.toPublicKey();
    const walletAddress = publicKey.toBase58();

    // Create signature using expectedHash.toFields() to match backend verification
    const signature = Signature.create(
      privateKey,
      verificationInputs.expectedHash.toFields()
    ).toBase58();

    return NextResponse.json({
      walletAddress,
      signature,
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
