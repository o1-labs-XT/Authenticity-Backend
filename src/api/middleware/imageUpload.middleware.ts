import multer from 'multer';
import { config } from '../../config/index.js';

export const imageUpload = multer({
  dest: '/tmp/uploads',
  limits: {
    fileSize: config.uploadMaxSize,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});
