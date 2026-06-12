/**
 * ClinicalIngestionStack — Hybrid Native AI Architecture
 *
 * Provisions:
 *  1. S3 bucket for Amazon Connect call recordings (HIPAA-compliant, 7-year retention)
 *  2. Five Lambda functions for the async post-call NLP pipeline
 *  3. AWS Step Functions Express State Machine that sequences:
 *       TranscribeMedical → WaitForTranscribe (retry) →
 *       ComprehendMedical → BedrockDiagnostic → SaveHistoricalInteraction
 *  4. Amazon EventBridge rule: fires on Amazon Connect CTR DISCONNECTED events
 *     and triggers the State Machine.
 *
 * Removed (obsolete real-time lambdas):
 *  - lex-fulfillment
 *  - vector-ingestion
 *  - summarization-agent
 *
 * Architecture rule: NO Lambda or Step Function runs while a call is live.
 * The EventBridge rule matches only AFTER the contact disconnects.
 */
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ClinicalIngestionStackProps extends cdk.StackProps {
  /** DynamoDB table name for HistoricalInteraction (from Amplify stack) */
  historicalInteractionTable?: string;
  /** Bedrock model ID to use for diagnostics */
  bedrockModelId?: string;
  /** Amazon Connect instance ARN — used to scope the EventBridge rule */
  connectInstanceArn?: string;
}

export class ClinicalIngestionStack extends cdk.Stack {
  /** Exported so BedrockKnowledgeBaseStack can read recordings when needed */
  public readonly recordingsBucket: s3.IBucket;
  /** Transcript output bucket (shared with recordings bucket for simplicity) */
  public readonly transcriptsBucket: s3.IBucket;

  constructor(scope: Construct, id: string, props?: ClinicalIngestionStackProps) {
    super(scope, id, props);

    const historicalInteractionTable =
      props?.historicalInteractionTable ?? 'HistoricalInteraction';
    const bedrockModelId =
      props?.bedrockModelId ?? 'anthropic.claude-3-sonnet-20240229-v1:0';

    // ──────────────────────────────────────────────────────────────────
    // 1. S3 BUCKETS
    // ──────────────────────────────────────────────────────────────────

    // Recordings bucket already exists (retained from previous deployment).
    this.recordingsBucket = s3.Bucket.fromBucketName(
      this,
      'CallRecordingsBucket',
      `clinical-call-recordings-${this.account}-${this.region}`
    );

    // Transcripts bucket — new, does not exist yet.
    this.transcriptsBucket = new s3.Bucket(this, 'TranscriptsBucket', {
      bucketName: `clinical-transcripts-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [
        {
          id: 'TranscriptRetention',
          enabled: true,
          expiration: cdk.Duration.days(2555), // 7 years
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ──────────────────────────────────────────────────────────────────
    // 2. SHARED LAMBDA EXECUTION ROLE
    // ──────────────────────────────────────────────────────────────────

    const pipelineRole = new iam.Role(this, 'PostCallPipelineRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
      inlinePolicies: {
        PostCallPipelinePolicy: new iam.PolicyDocument({
          statements: [
            // Transcribe Medical
            new iam.PolicyStatement({
              actions: [
                'transcribe:StartMedicalTranscriptionJob',
                'transcribe:GetMedicalTranscriptionJob',
              ],
              resources: ['*'],
            }),
            // S3 — recordings (read) + transcripts (read/write)
            new iam.PolicyStatement({
              actions: ['s3:GetObject', 's3:PutObject'],
              resources: [
                `${this.recordingsBucket.bucketArn}/*`,
                `${this.transcriptsBucket.bucketArn}/*`,
              ],
            }),
            // Comprehend Medical
            new iam.PolicyStatement({
              actions: [
                'comprehendmedical:DetectEntitiesV2',
                'comprehendmedical:InferICD10CM',
                'comprehendmedical:InferRxNorm',
              ],
              resources: ['*'],
            }),
            // Bedrock
            new iam.PolicyStatement({
              actions: ['bedrock:InvokeModel'],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/*`,
              ],
            }),
            // DynamoDB — write historical interactions
            new iam.PolicyStatement({
              actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
              resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${historicalInteractionTable}`,
              ],
            }),
          ],
        }),
      },
    });

    // ──────────────────────────────────────────────────────────────────
    // 3. LAMBDA FUNCTIONS
    //    All use NodejsFunction-style inline code paths via Code.fromAsset.
    //    Each function directory contains compiled JS alongside TS source.
    // ──────────────────────────────────────────────────────────────────

    const sharedRuntime = lambda.Runtime.NODEJS_20_X;
    const sharedEnv = { AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1' };

    /** Step 1 — Start Transcribe Medical job */
    const transcribeMedicalFn = new lambda.Function(this, 'TranscribeMedicalFn', {
      functionName: 'clinical-transcribe-medical',
      description: 'Post-call: starts Amazon Transcribe Medical job',
      runtime: sharedRuntime,
      role: pipelineRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      code: lambda.Code.fromAsset('functions/transcribe-medical'),
      handler: 'index.handler',
      environment: {
        ...sharedEnv,
        TRANSCRIBE_OUTPUT_BUCKET: this.transcriptsBucket.bucketName,
        TRANSCRIBE_OUTPUT_PREFIX: 'transcripts/',
      },
    });

    /** Step 2 — Poll Transcribe job status + extract transcript text */
    const getTranscribeResultFn = new lambda.Function(this, 'GetTranscribeResultFn', {
      functionName: 'clinical-get-transcribe-result',
      description: 'Post-call: polls Transcribe job and retrieves transcript text',
      runtime: sharedRuntime,
      role: pipelineRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      code: lambda.Code.fromAsset('functions/get-transcribe-result'),
      handler: 'index.handler',
      environment: { ...sharedEnv },
    });

    /** Step 3 — Comprehend Medical entity extraction */
    const comprehendMedicalFn = new lambda.Function(this, 'ComprehendMedicalFn', {
      functionName: 'clinical-comprehend-medical',
      description: 'Post-call: extracts clinical entities with Comprehend Medical',
      runtime: sharedRuntime,
      role: pipelineRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      code: lambda.Code.fromAsset('functions/comprehend-medical'),
      handler: 'index.handler',
      environment: { ...sharedEnv },
    });

    /** Step 4 — Bedrock diagnostic summary */
    const bedrockDiagnosticFn = new lambda.Function(this, 'BedrockDiagnosticFn', {
      functionName: 'clinical-bedrock-diagnostic',
      description: 'Post-call: generates clinical diagnostic summary via Bedrock',
      runtime: sharedRuntime,
      role: pipelineRole,
      timeout: cdk.Duration.minutes(10), // Bedrock can be slower
      memorySize: 512,
      code: lambda.Code.fromAsset('functions/bedrock-diagnostic'),
      handler: 'index.handler',
      environment: {
        ...sharedEnv,
        BEDROCK_MODEL_ID: bedrockModelId,
      },
    });

    /** Step 5 — Persist enriched interaction to DynamoDB */
    const saveHistoricalInteractionFn = new lambda.Function(
      this,
      'SaveHistoricalInteractionFn',
      {
        functionName: 'clinical-save-historical-interaction',
        description: 'Post-call: writes enriched HistoricalInteraction to DynamoDB',
        runtime: sharedRuntime,
        role: pipelineRole,
        timeout: cdk.Duration.minutes(5),
        memorySize: 512,
        code: lambda.Code.fromAsset('functions/save-historical-interaction'),
        handler: 'index.handler',
        environment: {
          ...sharedEnv,
          HISTORICAL_INTERACTION_TABLE: historicalInteractionTable,
        },
      }
    );

    // ──────────────────────────────────────────────────────────────────
    // 4. STEP FUNCTIONS STATE MACHINE
    // ──────────────────────────────────────────────────────────────────

    // --- Step 1: Start Transcribe Medical ---
    const startTranscribeTask = new tasks.LambdaInvoke(
      this,
      'StartTranscribeMedical',
      {
        lambdaFunction: transcribeMedicalFn,
        comment: 'Start async Amazon Transcribe Medical job',
        resultSelector: { 'Payload.$': '$.Payload' },
        resultPath: '$',
      }
    );

    // --- Step 2: Wait then get result (retry until job completes) ---
    const getTranscribeResultTask = new tasks.LambdaInvoke(
      this,
      'GetTranscribeResult',
      {
        lambdaFunction: getTranscribeResultFn,
        comment: 'Check Transcribe job status and extract transcript text',
        resultSelector: { 'Payload.$': '$.Payload' },
        resultPath: '$',
        // Retry if the job is still in progress (Lambda throws TranscribeJobInProgress)
        retryOnServiceExceptions: false,
      }
    ).addRetry({
      errors: ['TranscribeJobInProgress', 'Lambda.AWSLambdaException'],
      interval: cdk.Duration.seconds(30),
      maxAttempts: 20,
      backoffRate: 1.5,
    });

    // --- Step 3: Comprehend Medical ---
    const comprehendMedicalTask = new tasks.LambdaInvoke(
      this,
      'ComprehendMedical',
      {
        lambdaFunction: comprehendMedicalFn,
        comment: 'Extract clinical entities with Comprehend Medical',
        resultSelector: { 'Payload.$': '$.Payload' },
        resultPath: '$',
      }
    );

    // --- Step 4: Bedrock Diagnostic ---
    const bedrockDiagnosticTask = new tasks.LambdaInvoke(
      this,
      'BedrockDiagnostic',
      {
        lambdaFunction: bedrockDiagnosticFn,
        comment: 'Generate clinical diagnostic summary via Amazon Bedrock',
        resultSelector: { 'Payload.$': '$.Payload' },
        resultPath: '$',
      }
    );

    // --- Step 5: Save to DynamoDB ---
    const saveHistoricalInteractionTask = new tasks.LambdaInvoke(
      this,
      'SaveHistoricalInteraction',
      {
        lambdaFunction: saveHistoricalInteractionFn,
        comment: 'Persist enriched interaction to DynamoDB via HistoricalInteraction table',
        resultPath: sfn.JsonPath.DISCARD, // we don't need the return value
      }
    );

    // --- Pipeline completion ---
    const pipelineSucceeded = new sfn.Succeed(this, 'PipelineSucceeded', {
      comment: 'Post-call NLP pipeline completed successfully',
    });

    // --- Error handler ---
    const pipelineFailed = new sfn.Fail(this, 'PipelineFailed', {
      cause: 'Post-call pipeline encountered an unrecoverable error',
      error: 'PipelineError',
    });

    // Add error catchers to critical steps
    [startTranscribeTask, comprehendMedicalTask, bedrockDiagnosticTask, saveHistoricalInteractionTask].forEach(
      (task) => {
        task.addCatch(pipelineFailed, {
          errors: ['States.ALL'],
          resultPath: '$.errorInfo',
        });
      }
    );

    // --- Chain the state machine ---
    const definition = startTranscribeTask
      .next(getTranscribeResultTask)
      .next(comprehendMedicalTask)
      .next(bedrockDiagnosticTask)
      .next(saveHistoricalInteractionTask)
      .next(pipelineSucceeded);

    // CloudWatch log group for the state machine
    const stateMachineLogGroup = new logs.LogGroup(
      this,
      'PostCallPipelineLogGroup',
      {
        logGroupName: '/aws/states/clinical-post-call-pipeline',
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }
    );

    // State machine execution role
    const stateMachineRole = new iam.Role(this, 'PostCallStateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        InvokeLambda: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['lambda:InvokeFunction'],
              resources: [
                transcribeMedicalFn.functionArn,
                getTranscribeResultFn.functionArn,
                comprehendMedicalFn.functionArn,
                bedrockDiagnosticFn.functionArn,
                saveHistoricalInteractionFn.functionArn,
              ],
            }),
            new iam.PolicyStatement({
              actions: [
                'logs:CreateLogDelivery',
                'logs:GetLogDelivery',
                'logs:UpdateLogDelivery',
                'logs:DeleteLogDelivery',
                'logs:ListLogDeliveries',
                'logs:PutResourcePolicy',
                'logs:DescribeResourcePolicies',
                'logs:DescribeLogGroups',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    const postCallStateMachine = new sfn.StateMachine(
      this,
      'PostCallNlpPipeline',
      {
        stateMachineName: 'clinical-post-call-nlp-pipeline',
        definitionBody: sfn.DefinitionBody.fromChainable(definition),
        stateMachineType: sfn.StateMachineType.EXPRESS,
        role: stateMachineRole,
        timeout: cdk.Duration.hours(1),
        logs: {
          destination: stateMachineLogGroup,
          level: sfn.LogLevel.ERROR,
          includeExecutionData: false,
        },
        tracingEnabled: true,
      }
    );

    // ──────────────────────────────────────────────────────────────────
    // 5. EVENTBRIDGE RULE — Amazon Connect CTR Disconnect Trigger
    //
    //    Amazon Connect emits a "Amazon Connect Contact Trace Record"
    //    event when a contact disconnects. The event detail-type is
    //    "Amazon Connect Contact Trace Record" and the source is
    //    "aws.connect". We filter to InitiationMethod INBOUND / TRANSFER
    //    voice contacts only (adjust as needed).
    //
    //    Reference:
    //    https://docs.aws.amazon.com/connect/latest/adminguide/
    //    eventbridge.html#CTRs-via-EventBridge
    // ──────────────────────────────────────────────────────────────────

    // IAM role allowing EventBridge to start Step Functions executions
    const eventBridgeRole = new iam.Role(this, 'PostCallEventBridgeRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
      inlinePolicies: {
        StartExecution: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['states:StartExecution'],
              resources: [postCallStateMachine.stateMachineArn],
            }),
          ],
        }),
      },
    });

    // EventBridge input transformer: map CTR fields to the state machine input shape
    const inputTransformer = events.RuleTargetInput.fromObject({
      contactId: events.EventField.fromPath('$.detail.ContactId'),
      patientId: events.EventField.fromPath('$.detail.Attributes.patientId'),
      riskLevel: events.EventField.fromPath('$.detail.Attributes.riskLevel'),
      channelType: events.EventField.fromPath('$.detail.Channel'),
      queueName: events.EventField.fromPath('$.detail.Queue.Name'),
      agentUsername: events.EventField.fromPath('$.detail.Agent.Username'),
      recordingBucket: this.recordingsBucket.bucketName,
      recordingKey: events.EventField.fromPath('$.detail.RecordingLocation'),
      connectInstanceArn: events.EventField.fromPath('$.detail.InstanceARN'),
      eventTime: events.EventField.fromPath('$.time'),
    });

    new events.Rule(this, 'ConnectCtrDisconnectRule', {
      ruleName: 'clinical-connect-ctr-disconnect',
      description:
        'Triggers post-call NLP pipeline when a Connect voice contact disconnects',
      eventPattern: {
        source: ['aws.connect'],
        detailType: ['Amazon Connect Contact Trace Record'],
        detail: {
          // Only process VOICE contacts (skip CHAT/TASK which have no recording)
          Channel: ['VOICE'],
          // DisconnectReason present means the call has ended
          DisconnectReason: [
            'CUSTOMER_DISCONNECT',
            'AGENT_DISCONNECT',
            'THIRD_PARTY_DISCONNECT',
            'TELECOM_PROBLEM',
            'BARGED',
            'CONTACT_FLOW_DISCONNECT',
            'OTHER',
            'EXPIRED',
            'API',
          ],
        },
      },
      targets: [
        new targets.SfnStateMachine(postCallStateMachine, {
          input: inputTransformer,
          role: eventBridgeRole,
        }),
      ],
    });

    // ──────────────────────────────────────────────────────────────────
    // 6. OUTPUTS
    // ──────────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'RecordingsBucketName', {
      value: this.recordingsBucket.bucketName,
      description: 'S3 bucket for Amazon Connect call recordings',
      exportName: 'ClinicalRecordingsBucketName',
    });

    new cdk.CfnOutput(this, 'RecordingsBucketArn', {
      value: this.recordingsBucket.bucketArn,
      description: 'ARN of the recordings bucket',
      exportName: 'ClinicalRecordingsBucketArn',
    });

    new cdk.CfnOutput(this, 'TranscriptsBucketName', {
      value: this.transcriptsBucket.bucketName,
      description: 'S3 bucket for Transcribe Medical output',
      exportName: 'ClinicalTranscriptsBucketName',
    });

    new cdk.CfnOutput(this, 'PostCallStateMachineArn', {
      value: postCallStateMachine.stateMachineArn,
      description: 'ARN of the post-call NLP Step Functions state machine',
      exportName: 'ClinicalPostCallStateMachineArn',
    });

    new cdk.CfnOutput(this, 'PostCallStateMachineName', {
      value: postCallStateMachine.stateMachineName,
      description: 'Name of the post-call NLP Step Functions state machine',
    });
  }
}
