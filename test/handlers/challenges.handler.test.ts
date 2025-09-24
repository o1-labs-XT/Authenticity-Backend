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

    it('should create challenge with valid data', async () => {
      const mockChallenge = {
        id: 'test-id',
        title: 'Test Challenge',
        description: 'Test Description',
        start_time: new Date('2024-01-01'),
        end_time: new Date('2024-01-31'),
        participant_count: 0,
        chain_count: 1,
      };
      mockRepo.create.mockResolvedValue(mockChallenge);

      await handler.createChallenge(mockReq, mockRes, mockNext);

      expect(mockRepo.create).toHaveBeenCalledWith({
        title: 'Test Challenge',
        description: 'Test Description',
        start_time: new Date('2024-01-01T00:00:00Z'),
        end_time: new Date('2024-01-31T00:00:00Z'),
      });
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('response transformation', () => {
    it('should convert snake_case to camelCase in responses', async () => {
      const mockChallenge = {
        id: 'test-id',
        title: 'Test',
        description: 'Desc',
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-31T00:00:00Z',
        participant_count: 5,
        chain_count: 1,
      };
      mockRepo.findCurrent.mockResolvedValue(mockChallenge);

      mockReq = {};
      await handler.getCurrentChallenge(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        id: 'test-id',
        title: 'Test',
        description: 'Desc',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-31T00:00:00Z'),
        participantCount: 5,
        chainCount: 1,
      });
    });

    it('should format dates as Date objects', async () => {
      const mockChallenge = {
        id: 'test-id',
        title: 'Test',
        description: 'Desc',
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-31T00:00:00Z',
        participant_count: 0,
        chain_count: 1,
      };
      mockRepo.findById.mockResolvedValue(mockChallenge);

      mockReq = { params: { id: 'test-id' } };
      await handler.getChallenge(mockReq, mockRes, mockNext);

      const response = mockRes.json.mock.calls[0][0];
      expect(response.startTime).toBeInstanceOf(Date);
      expect(response.endTime).toBeInstanceOf(Date);
    });
  });

  describe('error handling', () => {
    it('should return 404 for missing current challenge', async () => {
      mockRepo.findCurrent.mockResolvedValue(null);

      mockReq = {};
      await handler.getCurrentChallenge(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Challenge not found',
          statusCode: 404,
        })
      );
    });

    it('should return 404 when deleting non-existent challenge', async () => {
      mockRepo.delete.mockResolvedValue(false);

      mockReq = { params: { id: 'non-existent' } };
      await handler.deleteChallenge(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Challenge not found',
          statusCode: 404,
        })
      );
    });

    it('should return 201 for successful creation', async () => {
      const mockChallenge = {
        id: 'new-id',
        title: 'New',
        description: 'New Desc',
        start_time: new Date(),
        end_time: new Date(),
        participant_count: 0,
        chain_count: 1,
      };
      mockRepo.create.mockResolvedValue(mockChallenge);

      mockReq = {
        body: {
          title: 'New',
          description: 'New Desc',
          startTime: '2024-01-01',
          endTime: '2024-01-31',
        },
      };
      await handler.createChallenge(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it('should return 204 for successful deletion', async () => {
      mockRepo.delete.mockResolvedValue(true);

      mockReq = { params: { id: 'test-id' } };
      await handler.deleteChallenge(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(204);
      expect(mockRes.send).toHaveBeenCalled();
    });

    it('should handle repository errors', async () => {
      const error = new Error('Database error');
      mockRepo.findAll.mockRejectedValue(error);

      mockReq = {};
      await handler.getAllChallenges(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });
});
