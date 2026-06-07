/**
 * ClinicalIngestionStack
 *
 * Provisions the secure S3 bucket for Amazon Connect call recordings.
 * Custom AI processing (Transcribe Medical, Comprehend Medical) has been
 * replaced by native Amazon Connect Contact Lens + Bedrock Knowledge Base.
 *
 * Remaining responsibilities:
 *  - Call recordings bucket (HIPAA-compliant, 7-year retention)
 *  - EventBridge notification so downstream stacks can react to new recordings
 */
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class ClinicalIngestionStack extends cdk.Stack {
  /** Exported so BedrockKnowledgeBaseStack can read recordings when needed */
  public readonly recordingsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── S3 Bucket: Call Recordings ─────────────────────────────────────
    this.recordingsBucket = new s3.Bucket(this, 'CallRecordingsBucket', {
      bucketName: `clinical-call-recordings-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          id: 'HipaaRetention',
          enabled: true,
          expiration: cdk.Duration.days(2555), // 7 years
        },
      ],
      // EventBridge events so the CTR processor can listen for recordings
      eventBridgeEnabled: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Outputs ────────────────────────────────────────────────────────
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
  }
}
