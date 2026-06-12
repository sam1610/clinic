/**
 * BedrockKnowledgeBaseStack
 *
 * Provisions:
 *  1. S3 bucket: clinic-medical-guidelines-kb  (imported if it already exists)
 *     - Stores medical guidelines, drug formularies, clinical protocols
 *
 *  2. Secrets Manager secret: PineconeApiKeySecret
 *     - Placeholder — manually populate the secret value in the AWS Console
 *       with your Pinecone API key before triggering a KB sync.
 *
 *  3. Amazon Bedrock Knowledge Base (Pinecone vector store)
 *     - Embedding model : Amazon Titan Text Embeddings V2 (1024 dims)
 *     - Vector store    : Pinecone Serverless (external)
 *     - Update the connectionString in the console once your Pinecone index
 *       is ready.
 *
 *  4. S3 Data Source wired to the Knowledge Base
 *
 *  5. Lambda: clinical-ctr-persist
 *     - Triggered by EventBridge CTR events from Amazon Connect
 *     - Writes Contact Lens summary to the HistoricalInteraction DynamoDB table
 */
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

export interface BedrockKnowledgeBaseStackProps extends cdk.StackProps {
  /** Amplify HistoricalInteraction DynamoDB table name */
  historicalInteractionTableName?: string;
  /** Amplify HistoricalInteraction DynamoDB table ARN */
  historicalInteractionTableArn?: string;
}

export class BedrockKnowledgeBaseStack extends cdk.Stack {
  public readonly guidelinesBucket: s3.IBucket;
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly saveHistoricalInteractionFn: lambda.Function;

  constructor(scope: Construct, id: string, props?: BedrockKnowledgeBaseStackProps) {
    super(scope, id, props);

    const tableArn = props?.historicalInteractionTableArn
      ?? `arn:aws:dynamodb:${this.region}:${this.account}:table/HistoricalInteraction*`;

    // ── 1. S3 Bucket: Medical Guidelines ──────────────────────────────
    // Import the bucket if it already exists (RemovalPolicy.RETAIN kept it alive).
    this.guidelinesBucket = s3.Bucket.fromBucketName(
      this,
      'MedicalGuidelinesBucket',
      `clinic-medical-guidelines-kb-${this.account}-${this.region}`
    );

    // ── 2. Pinecone API Key Secret ─────────────────────────────────────
    //
    // Secret already exists (RETAIN policy kept it alive).
    // Value is stored as JSON: {"apiKey": "<pinecone-key>"}
    // which is the format Bedrock requires for Pinecone credentials.
    // Using fromSecretCompleteArn so the IAM policy gets the exact ARN
    // (including the random suffix) rather than a wildcard.
    const pineconeSecretArn = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:clinical/pinecone-api-key-BAmBkp`;
    const pineconeApiKeySecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'PineconeApiKeySecret',
      pineconeSecretArn
    );

    // ── 3. IAM Role for Bedrock Knowledge Base ─────────────────────────
    const kbRole = new iam.Role(this, 'BedrockKBRole', {
      roleName: 'ClinicalBedrockKnowledgeBaseRole',
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [
                this.guidelinesBucket.bucketArn,
                `${this.guidelinesBucket.bucketArn}/*`,
              ],
            }),
          ],
        }),
        BedrockEmbeddings: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['bedrock:InvokeModel'],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
              ],
            }),
          ],
        }),
        PineconeSecret: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [pineconeApiKeySecret.secretArn],
            }),
          ],
        }),
      },
    });

    // ── 4. Bedrock Knowledge Base (Pinecone) ───────────────────────────
    //
    // connectionString: replace with your real Pinecone index host once it
    // is created in the Pinecone console (Settings → Indexes → Host).
    // Format: https://<index-name>-<project-id>.svc.<environment>.pinecone.io
    //
    // You can update this value directly in the AWS Console under:
    //   Amazon Bedrock → Knowledge Bases → clinical-medical-guidelines
    //   → Edit → Data storage → Pinecone configuration
    this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'ClinicalKnowledgeBase', {
      name: 'clinical-medical-guidelines',
      description:
        'Medical guidelines, clinical protocols, drug formularies, and DSM-5 criteria ' +
        'for DigiCall Clinic AI agents. Vector store: Pinecone Serverless.',
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn:
            `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              dimensions: 1024,
              embeddingDataType: 'FLOAT32',
            },
          },
        },
      },
      storageConfiguration: {
        type: 'PINECONE',
        pineconeConfiguration: {
          // ⚠ Placeholder — update with your real Pinecone index host URL
          connectionString: 'https://clinic-medical-index-s8zchl2.svc.aped-4627-b74a.pinecone.io',
          credentialsSecretArn: pineconeApiKeySecret.secretArn,
          fieldMapping: {
            textField: 'text',
            metadataField: 'metadata',
          },
        },
      },
    });

    // ── 5. S3 Data Source ──────────────────────────────────────────────
    const dataSource = new bedrock.CfnDataSource(this, 'GuidelinesDataSource', {
      name: 'medical-guidelines-s3',
      description: 'Clinical guidelines, protocols, and formularies from S3',
      knowledgeBaseId: this.knowledgeBase.attrKnowledgeBaseId,
      dataSourceConfiguration: {
        s3Configuration: {
          bucketArn: this.guidelinesBucket.bucketArn,
        },
        type: 'S3',
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'HIERARCHICAL',
          hierarchicalChunkingConfiguration: {
            levelConfigurations: [
              { maxTokens: 1500 }, // parent chunk
              { maxTokens: 300 },  // child chunk
            ],
            overlapTokens: 60,
          },
        },
      },
    });

    dataSource.addDependency(this.knowledgeBase);

    // ── 6. Lambda: clinical-ctr-persist ───────────────────────────────
    //
    // Handles raw CTR events from Connect → EventBridge.
    // Distinct from the Step Functions pipeline Lambda in ClinicalIngestionStack.
    this.saveHistoricalInteractionFn = new lambda.Function(
      this,
      'SaveHistoricalInteractionFn',
      {
        functionName: 'clinical-ctr-persist',
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(
          path.join(__dirname, '../functions/save-historical-interaction')
        ),
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        environment: {
          HISTORICAL_INTERACTION_TABLE:
            props?.historicalInteractionTableName ??
            'HistoricalInteraction-xbseoxrhxfa4tpsomwm3meyily-NONE',
        },
        logGroup: new logs.LogGroup(this, 'CtrPersistLogGroup', {
          logGroupName: '/aws/lambda/clinical-ctr-persist',
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }
    );

    this.saveHistoricalInteractionFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [tableArn],
      })
    );

    // ── 7. EventBridge Rule: Connect CTR events ────────────────────────
    const ctrRule = new events.Rule(this, 'ConnectCTRRule', {
      ruleName: 'clinical-connect-ctr',
      description:
        'Fires on every Amazon Connect Contact Trace Record to persist ' +
        'Contact Lens summary to the HistoricalInteraction table.',
      eventPattern: {
        source: ['aws.connect'],
        detailType: ['Amazon Connect Contact Trace Record'],
      },
    });

    ctrRule.addTarget(
      new targets.LambdaFunction(this.saveHistoricalInteractionFn, {
        retryAttempts: 2,
      })
    );

    // ── Outputs ────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'GuidelinesBucketName', {
      value: this.guidelinesBucket.bucketName,
      description: 'S3 bucket for medical guidelines KB data source',
      exportName: 'ClinicalGuidelinesBucketName',
    });

    new cdk.CfnOutput(this, 'PineconeApiKeySecretArn', {
      value: pineconeApiKeySecret.secretArn,
      description:
        'Secrets Manager ARN for the Pinecone API key — populate manually in the console',
      exportName: 'ClinicalPineconeApiKeySecretArn',
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: this.knowledgeBase.attrKnowledgeBaseId,
      description: 'Bedrock Knowledge Base ID',
      exportName: 'ClinicalKnowledgeBaseId',
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseArn', {
      value: this.knowledgeBase.attrKnowledgeBaseArn,
      description: 'Bedrock Knowledge Base ARN',
      exportName: 'ClinicalKnowledgeBaseArn',
    });

    new cdk.CfnOutput(this, 'CtrPersistFnArn', {
      value: this.saveHistoricalInteractionFn.functionArn,
      description: 'Lambda that writes CTR summaries to HistoricalInteraction table',
      exportName: 'ClinicalCtrPersistFnArn',
    });
  }
}
