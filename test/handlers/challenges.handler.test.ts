import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChallengesHandler } from '../../src/handlers/challenges.handler.js';

describe('ChallengesHandler', () => {
  let handler: ChallengesHandler;
  let mockRepo: any;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    // Create fresh mocks for each test
    mockRepo = {
      findCurrent: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      incrementParticipantCount: vi.fn(),
    };

    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    mockNext = vi.fn();

    handler = new ChallengesHandler(mockRepo);
  });

  describe('createChallenge validation', () => {
    beforeEach(() => {
      mockReq = {
        body: {
          title: 'Test Challenge',
          description: 'Test Description',
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-31T00:00:00Z',
        },
      };
    });

    it('should require title field', async () => {
      delete mockReq.body.title;

      await handler.createChallenge(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'title is required',
          field: 'title',
          statusCode: 400,
        })
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('should require description field', async () => {
      delete mockReq.body.description;

      await handler.createChallenge(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'description is required',
          field: 'description',
          statusCode: 400,
        })
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('should require startTime field', async () => {
      delete mockReq.body.startTime;

      await handler.createChallenge(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'startTime is required',
          field: 'startTime',
          statusCode: 400,
        })
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('should require endTime field', async () => {
      delete mockReq.body.endTime;

      await handler.createChallenge(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'endTime is required',
          field: 'endTime',
          statusCode: 400,
        })
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('should reject challenge when endTime is before startTime', async () => {
      mockReq.body = {
        title: 'Test Challenge',
        description: 'Test Description',
        startTime: '2024-12-31T00:00:00Z',
        endTime: '2024-01-01T00:00:00Z', // End is before start
      };

      await handler.createChallenge(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'endTime must be after startTime',
          statusCode: 400,
        })
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });
  });
});
