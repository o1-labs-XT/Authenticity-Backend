import sinon from 'sinon';
import { Field, PublicKey, Signature, PrivateKey } from 'o1js';

/**
 * Mock Mina types for testing
 */
export class MockMinaTypes {
  static createMockField(value: number = 1): Field {
    return Field(value);
  }

  static createMockPublicKey(): PublicKey {
    return PrivateKey.random().toPublicKey();
  }

  static createMockSignature(): Signature {
    const privateKey = PrivateKey.random();
    const publicKey = privateKey.toPublicKey();
    const message = [Field(1), Field(2)];
    return Signature.create(privateKey, message);
  }

  static createMockPrivateKey(): PrivateKey {
    return PrivateKey.random();
  }
}

/**
 * Create mock services for testing
 */
export class MockServices {
  static createMockHashingService() {
    return {
      computeSHA256: sinon.stub().returns('mock-sha256-hash'),
      sha256ToField: sinon.stub().returns(Field(1)),
      computePoseidonHash: sinon.stub().returns(Field(2)),
      computeOnChainCommitment: sinon.stub().returns(Field(3)),
      verifyImageHash: sinon.stub().returns(true),
      fieldToHex: sinon.stub().returns('0x123'),
    };
  }

  static createMockVerificationService() {
    return {
      prepareForVerification: sinon.stub().returns({
        expectedHash: Field(1),
        penultimateState: [],
        initialState: [],
        messageWord: Field(0),
        roundConstant: Field(0),
      }),
      prepareFromBuffer: sinon.stub().returns({
        expectedHash: Field(1),
        penultimateState: [],
        initialState: [],
        messageWord: Field(0),
        roundConstant: Field(0),
      }),
      verifySignature: sinon.stub().returns(true),
      parseSignature: sinon.stub().returns(MockMinaTypes.createMockSignature()),
      parsePublicKey: sinon.stub().returns(MockMinaTypes.createMockPublicKey()),
      generateTokenOwnerAddress: sinon.stub().returns('B62mock-token-owner'),
      createAuthenticityInputs: sinon.stub(),
      createFinalRoundInputs: sinon.stub(),
      validateInputs: sinon.stub().returns({ valid: true }),
    };
  }

  static createMockProofQueueService() {
    return {
      enqueueProofGeneration: sinon.stub().resolves('task-id-1'),
      enqueueProofPublishing: sinon.stub().resolves('task-id-2'),
      setProofGenerationHandler: sinon.stub(),
      setProofPublishingHandler: sinon.stub(),
      getMetrics: sinon.stub().returns({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        avgProcessingTime: 0,
      }),
      getQueueSize: sinon.stub().returns(0),
      clearQueue: sinon.stub(),
      getTask: sinon.stub(),
    };
  }

  static createMockRepository() {
    return {
      insertPendingRecord: sinon.stub().resolves(),
      checkExistingImage: sinon.stub().resolves({ exists: false }),
      updateRecordStatus: sinon.stub().resolves(),
      getRecordByHash: sinon.stub().resolves(null),
      getRecordStatus: sinon.stub().resolves(null),
      deleteFailedRecord: sinon.stub().resolves(false),
      incrementRetryCount: sinon.stub().resolves(),
      getPendingRecords: sinon.stub().resolves([]),
      getRetriableRecords: sinon.stub().resolves([]),
      getStatistics: sinon.stub().resolves({
        total: 0,
        pending: 0,
        verified: 0,
        failed: 0,
      }),
      cleanupOldFailedRecords: sinon.stub().resolves(0),
      executeQuery: sinon.stub().resolves([]),
      transaction: sinon.stub().callsFake((fn) => fn()),
    };
  }

  static createMockProofGenerationService() {
    return {
      compile: sinon.stub().resolves(),
      generateProof: sinon.stub().resolves({
        proof: { mock: 'proof' },
        publicInputs: { mock: 'inputs' },
      }),
      verifyProof: sinon.stub().resolves(true),
      isCompiled: sinon.stub().returns(false),
    };
  }

  static createMockProofPublishingService() {
    return {
      compile: sinon.stub().resolves(),
      publishProof: sinon.stub().resolves('tx-hash-123'),
      getTokenId: sinon.stub().returns(Field(1)),
      isDeployed: sinon.stub().resolves(true),
      isCompiled: sinon.stub().returns(false),
    };
  }

  static createMockZkAppInteractionService() {
    return {
      getTokenAccountState: sinon.stub().resolves({
        commitment: Field(1),
        creatorX: Field(2),
        creatorIsOdd: Field(0),
        exists: true,
      }),
      reconstructCreatorPublicKey: sinon.stub().returns(MockMinaTypes.createMockPublicKey()),
      verifyImageCommitment: sinon.stub().resolves({
        verified: true,
        creatorPublicKey: 'B62mock-creator',
      }),
      getZkAppState: sinon.stub().resolves({
        exists: true,
        balance: '1000000',
        nonce: '1',
      }),
      getTokenId: sinon.stub().returns(Field(1)),
      switchNetwork: sinon.stub(),
    };
  }
}

/**
 * Create mock Express request and response objects
 */
export class MockHttp {
  static createMockRequest(overrides?: any) {
    return {
      method: 'GET',
      path: '/',
      params: {},
      query: {},
      body: {},
      headers: {},
      file: undefined,
      ip: '127.0.0.1',
      ...overrides,
    };
  }

  static createMockResponse() {
    const res: any = {
      status: sinon.stub().returnsThis(),
      json: sinon.stub().returnsThis(),
      send: sinon.stub().returnsThis(),
      end: sinon.stub().returnsThis(),
      on: sinon.stub(),
      statusCode: 200,
    };
    return res;
  }

  static createMockNext() {
    return sinon.stub();
  }
}