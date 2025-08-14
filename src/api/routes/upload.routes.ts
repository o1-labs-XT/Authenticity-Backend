import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { UploadHandler } from '../../handlers/upload.handler.js';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Store uploads in a temporary directory
    cb(null, '/tmp');
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.UPLOAD_MAX_SIZE || '10485760'), // Default 10MB
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`));
    }
  },
});

export function createUploadRoutes(uploadHandler: UploadHandler): Router {
  const router = Router();

  /**
   * POST /api/upload
   * 
   * Upload an image with signature for authenticity proof generation
   * 
   * Request:
   * - multipart/form-data
   * - Fields:
   *   - image: File (required) - The image file to verify
   *   - publicKey: string (required) - Base58 encoded public key
   *   - signature: string (required) - Base58 encoded signature of SHA256 hash
   * 
   * Response:
   * - 200: { tokenOwnerAddress: string, sha256Hash?: string, status: 'pending' | 'duplicate' }
   * - 400: Validation error
   * - 500: Internal error
   */
  router.post(
    '/upload',
    upload.single('image'),
    async (req, res, next) => {
      try {
        await uploadHandler.handleUpload(req, res);
      } catch (error) {
        next(error);
      }
    }
  );

  // Handle multer errors
  router.use((error: any, req: any, res: any, next: any) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File size exceeds limit of ${process.env.UPLOAD_MAX_SIZE || '10MB'}`,
            field: 'image',
          },
        });
      }
      return res.status(400).json({
        error: {
          code: 'UPLOAD_ERROR',
          message: error.message,
        },
      });
    }
    next(error);
  });

  return router;
}