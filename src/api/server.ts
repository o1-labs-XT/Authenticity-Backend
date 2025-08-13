import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createUploadRoutes } from './routes/upload.routes';
import { createStatusRoutes } from './routes/status.routes';
import { createTokenOwnerRoutes } from './routes/tokenOwner.routes';
import { errorMiddleware } from './middleware/error.middleware';
import { loggingMiddleware } from './middleware/logging.middleware';
import { UploadHandler } from '../handlers/upload.handler';
import { StatusHandler } from '../handlers/status.handler';
import { TokenOwnerHandler } from '../handlers/tokenOwner.handler';

export interface ServerDependencies {
  uploadHandler: UploadHandler;
  statusHandler: StatusHandler;
  tokenOwnerHandler: TokenOwnerHandler;
}

export function createServer(dependencies: ServerDependencies): Express {
  const app = express();

  // Security middleware
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow images from different origins
  }));

  // CORS configuration
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Compression middleware
  app.use(compression());

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Logging middleware
  app.use(loggingMiddleware);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
    });
  });

  // API version endpoint
  app.get('/api/version', (req, res) => {
    res.json({
      version: '1.0.0',
      api: 'Provenance Backend API',
      zkApp: process.env.ZKAPP_ADDRESS || 'not configured',
    });
  });

  // Mount API routes
  const uploadRoutes = createUploadRoutes(dependencies.uploadHandler);
  const statusRoutes = createStatusRoutes(dependencies.statusHandler);
  const tokenOwnerRoutes = createTokenOwnerRoutes(dependencies.tokenOwnerHandler);

  app.use('/api', uploadRoutes);
  app.use('/api', statusRoutes);
  app.use('/api', tokenOwnerRoutes);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Cannot ${req.method} ${req.path}`,
      },
    });
  });

  // Error handling middleware (must be last)
  app.use(errorMiddleware);

  return app;
}