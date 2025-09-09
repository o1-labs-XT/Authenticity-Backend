import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from '../config/index.js';
import { createUploadRoutes } from './routes/upload.routes.js';
import { createStatusRoutes } from './routes/status.routes.js';
import { createTokenOwnerRoutes } from './routes/tokenOwner.routes.js';
import { createAdminRoutes } from './routes/admin.routes.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { loggingMiddleware } from './middleware/logging.middleware.js';
import { contextMiddleware } from './middleware/context.middleware.js';
import { UploadHandler } from '../handlers/upload.handler.js';
import { StatusHandler } from '../handlers/status.handler.js';
import { TokenOwnerHandler } from '../handlers/tokenOwner.handler.js';
import { AdminHandler } from '../handlers/admin.handler.js';

export interface ServerDependencies {
  uploadHandler: UploadHandler;
  statusHandler: StatusHandler;
  tokenOwnerHandler: TokenOwnerHandler;
  adminHandler?: AdminHandler;
}

export function createServer(dependencies: ServerDependencies): Express {
  const app = express();

  // Security middleware
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow images from different origins
  }));

  // CORS configuration
  app.use(cors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Compression middleware
  app.use(compression());

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Context middleware (must be before logging)
  app.use(contextMiddleware);

  // Logging middleware
  app.use(loggingMiddleware);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.nodeEnv,
    });
  });

  // API version endpoint
  app.get('/api/version', (req, res) => {
    res.json({
      version: '1.0.0',
      api: 'Provenance Backend API',
      zkApp: config.zkappAddress || 'not configured',
    });
  });

  // Mount API routes
  const uploadRoutes = createUploadRoutes(dependencies.uploadHandler);
  const statusRoutes = createStatusRoutes(dependencies.statusHandler);
  const tokenOwnerRoutes = createTokenOwnerRoutes(dependencies.tokenOwnerHandler);

  app.use('/api', uploadRoutes);
  app.use('/api', statusRoutes);
  app.use('/api', tokenOwnerRoutes);

  // Mount admin routes if handler is provided
  if (dependencies.adminHandler) {
    const adminRoutes = createAdminRoutes(dependencies.adminHandler);
    app.use('/api', adminRoutes);
  }

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