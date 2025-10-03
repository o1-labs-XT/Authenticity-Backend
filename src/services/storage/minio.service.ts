import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

export class MinioStorageService {
  private client = new S3Client({
    endpoint: config.minioEndpoint,
    region: 'us-east-1', // MinIO requires this for s3 compat but ignores it
    credentials: {
      accessKeyId: config.minioAccessKey,
      secretAccessKey: config.minioSecretKey,
    },
    forcePathStyle: true,
  });

  async uploadImage(sha256Hash: string, buffer: Buffer): Promise<string> {
    const key = `images/${sha256Hash}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: config.minioBucket,
        Key: key,
        Body: buffer,
      })
    );
    logger.debug(`Uploaded to MinIO: ${key}`);
    return key;
  }

  async downloadImage(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: config.minioBucket,
        Key: key,
      })
    );

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async deleteImage(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: config.minioBucket,
        Key: key,
      })
    );
    logger.debug(`Deleted from MinIO: ${key}`);
  }
}
