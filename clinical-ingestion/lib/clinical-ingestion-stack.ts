import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ClinicalIngestionStackProps extends cdk.StackProps {
  /**
   * DynamoDB table name for ClinicalInteraction (from Amplify Gen 2)
   * Format: ClinicalInteraction-<amplify-app-id>-<branch>
   */
  clinicalInteractionTableName?: string;

  /**
   * DynamoDB table name for ClinicalEntities (from Amplify Gen 2)
   * Format: ClinicalEntities-<amplify-app-id>-<branch>
   */
  clinicalEntitiesTableName?: string;
}

export class ClinicalIngestionStack extends cdk.Stack {
  public readonly recordingsBucket: s3.Bucket;
  public readonly transcribeFunction: lambda.Function;
  public readonly comprehendFunction: lambda.Function;

  constructor(scope: Construct, id: string, props?: ClinicalIngestionStackProps) {
    super(scope, id, props);

    // ========================================
    // S3 Bucket for Call Recordings
    // ========================================
    this.recordingsBucket = new s3.Bucket(this, 'CallRecordingsBucket', {
      bucketName: `clinical-call-recordings-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          id: 'DeleteOldRecordings',
          enabled: true,
          expiration: cdk.Duration.days(2555), // 7 years (HIPAA compliance)
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // ========================================
    // Lambda Function: Transcribe Medical
    // ========================================
    this.transcribeFunction = new lambda.Function(this, 'TranscribeMedicalFunction', {
      functionName: 'clinical-transcribe-medical',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../functions/transcribe-medical')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        RECORDINGS_BUCKET: this.recordingsBucket.bucketName,
        TRANSCRIBE_OUTPUT_BUCKET: this.recordingsBucket.bucketName,
        TRANSCRIBE_OUTPUT_PREFIX: 'transcripts/',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Grant permissions to Transcribe Medical
    this.transcribeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'transcribe:StartMedicalTranscriptionJob',
          'transcribe:GetMedicalTranscriptionJob',
        ],
        resources: ['*'],
      })
    );

    // Grant read access to recordings bucket
    this.recordingsBucket.grantRead(this.transcribeFunction);

    // Grant write access to transcripts prefix
    this.recordingsBucket.grantWrite(this.transcribeFunction, 'transcripts/*');

    // ========================================
    // Lambda Function: Comprehend Medical
    // ========================================
    this.comprehendFunction = new lambda.Function(this, 'ComprehendMedicalFunction', {
      functionName: 'clinical-comprehend-medical',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../functions/comprehend-medical')),
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024,
      environment: {
        CLINICAL_INTERACTION_TABLE: props?.clinicalInteractionTableName || 'ClinicalInteraction',
        CLINICAL_ENTITIES_TABLE: props?.clinicalEntitiesTableName || 'ClinicalEntities',
        RECORDINGS_BUCKET: this.recordingsBucket.bucketName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Grant permissions to Comprehend Medical
    this.comprehendFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'comprehendmedical:DetectEntitiesV2',
          'comprehendmedical:InferICD10CM',
          'comprehendmedical:InferRxNorm',
        ],
        resources: ['*'],
      })
    );

    // Grant DynamoDB write permissions
    this.comprehendFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props?.clinicalInteractionTableName || 'ClinicalInteraction*'}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props?.clinicalEntitiesTableName || 'ClinicalEntities*'}`,
        ],
      })
    );

    // Grant read access to recordings bucket (for transcript files)
    this.recordingsBucket.grantRead(this.comprehendFunction);

    // ========================================
    // EventBridge Rule: S3 Object Created
    // ========================================
    const s3ObjectCreatedRule = new events.Rule(this, 'S3ObjectCreatedRule', {
      ruleName: 'clinical-recording-uploaded',
      description: 'Triggers when a new call recording is uploaded to S3',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [this.recordingsBucket.bucketName],
          },
          object: {
            key: [{ prefix: 'recordings/' }],
          },
        },
      },
    });

    // Add Transcribe Lambda as target
    s3ObjectCreatedRule.addTarget(
      new targets.LambdaFunction(this.transcribeFunction, {
        retryAttempts: 2,
      })
    );

    // Enable EventBridge notifications on the S3 bucket
    this.recordingsBucket.enableEventBridgeNotification();

    // ========================================
    // EventBridge Rule: Transcribe Job Complete
    // ========================================
    const transcribeCompleteRule = new events.Rule(this, 'TranscribeCompleteRule', {
      ruleName: 'clinical-transcribe-complete',
      description: 'Triggers when Transcribe Medical job completes',
      eventPattern: {
        source: ['aws.transcribe'],
        detailType: ['Transcribe Medical Job State Change'],
        detail: {
          TranscriptionJobStatus: ['COMPLETED'],
        },
      },
    });

    // Add Comprehend Lambda as target
    transcribeCompleteRule.addTarget(
      new targets.LambdaFunction(this.comprehendFunction, {
        retryAttempts: 2,
      })
    );

    // ========================================
    // Outputs
    // ========================================
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

    new cdk.CfnOutput(this, 'TranscribeFunctionArn', {
      value: this.transcribeFunction.functionArn,
      description: 'ARN of the Transcribe Medical Lambda function',
      exportName: 'ClinicalTranscribeFunctionArn',
    });

    new cdk.CfnOutput(this, 'ComprehendFunctionArn', {
      value: this.comprehendFunction.functionArn,
      description: 'ARN of the Comprehend Medical Lambda function',
      exportName: 'ClinicalComprehendFunctionArn',
    });
  }
}
