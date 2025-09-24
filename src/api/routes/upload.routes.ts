import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../config/index.js';
import { UploadHandler } from '../../handlers/upload.handler.js';
import { ApiError } from '../../utils/errors.js';

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
    fileSize: config.uploadMaxSize,
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

/**
 * Convert Multer errors to ApiError
 */
function handleMulterError(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      next(new ApiError(413, `File size exceeds limit of ${config.uploadMaxSize} bytes`, 'image'));
    } else if (error.code === 'LIMIT_FILE_COUNT') {
      next(new ApiError(400, 'Too many files uploaded', 'image'));
    } else if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      next(new ApiError(400, `Unexpected field: ${error.field}`, error.field));
    } else {
      next(new ApiError(400, error.message));
    }
  } else if (error) {
    // Handle file type errors from fileFilter
    const message = error instanceof Error ? error.message : 'Invalid file upload';
    next(new ApiError(400, message, 'image'));
  } else {
    next();
  }
}

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
    handleMulterError, // Convert Multer errors to ApiError
    async (req: Request, res: Response, next: NextFunction) => {
      await uploadHandler.handleUpload(req, res, next);
    }
  );

  return router;
}
