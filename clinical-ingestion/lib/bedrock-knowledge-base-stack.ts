/**
 * BedrockKnowledgeBaseStack
 *
 * Provisions:
 *  1. S3 bucket: clinic-medical-guidelines-kb
 *     - Stores medical guidelines, drug formularies, clinical protocols
 *       that the Bedrock agents query at runtime.
 *
 *  2. Amazon Bedrock Knowledge Base
 *     - Data source: the S3 bucket above
 *     - Embedding model: Amazon Titan Text Embeddings V2
 *     - Vector store: Bedrock-managed OpenSearch Serverless (auto-provisioned)
 *
 *  3. Lambda: SaveHistoricalInteraction
 *     - Triggered by EventBridge CTR (Contact Trace Record) events from Connect
 *     - Parses Contact Lens summary out of the CTR
 *     - Writes a record to the Amplify HistoricalInteraction DynamoDB table
 */
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';
import * as path from 'path';

export interface BedrockKnowledgeBaseStackProps extends cdk.StackProps {
  /** Amplify HistoricalInteraction DynamoDB table name */
  historicalInteractionTableName?: string;
  /** Amplify HistoricalInteraction DynamoDB table ARN */
  historicalInteractionTableArn?: string;
}

export class BedrockKnowledgeBaseStack extends cdk.Stack {
  public readonly guidelinesBucket: s3.Bucket;
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly saveHistoricalInteractionFn: lambda.Function;

  constructor(scope: Construct, id: string, props?: BedrockKnowledgeBaseStackProps) {
    super(scope, id, props);

    const tableArn = props?.historicalInteractionTableArn
      ?? `arn:aws:dynamodb:${this.region}:${this.account}:table/HistoricalInteraction*`;

    // ── 1. S3 Bucket: Medical Guidelines ──────────────────────────────
    this.guidelinesBucket = new s3.Bucket(this, 'MedicalGuidelinesBucket', {
      bucketName: `clinic-medical-guidelines-kb-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          id: 'ExpireNoncurrentVersions',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── 2. IAM Role for Bedrock Knowledge Base ─────────────────────────
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
        OpenSearchServerless: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['aoss:APIAccessAll'],
              resources: [`arn:aws:aoss:${this.region}:${this.account}:collection/*`],
            }),
          ],
        }),
      },
    });

    // ── 3. Bedrock Knowledge Base ──────────────────────────────────────
    //
    // Uses Bedrock-managed OpenSearch Serverless vector store.
    // AWS automatically creates and manages the collection.
    this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'ClinicalKnowledgeBase', {
      name: 'clinical-medical-guidelines',
      description:
        'Medical guidelines, clinical protocols, drug formularies, and DSM-5 criteria ' +
        'for DigiCall Clinic AI agents.',
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn:
            `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              dimensions: 1024,        // Titan Text Embeddings V2 native dimension
              embeddingDataType: 'FLOAT32',
            },
          },
        },
      },
      storageConfiguration: {
        // OPENSEARCH_SERVERLESS tells Bedrock to provision and manage the
        // vector store automatically — no manual collection creation needed.
        type: 'OPENSEARCH_SERVERLESS',
        opensearchServerlessConfiguration: {
          collectionArn:
            `arn:aws:aoss:${this.region}:${this.account}:collection/clinical-kb`,
          vectorIndexName: 'clinical-medical-index',
          fieldMapping: {
            vectorField: 'embedding',
            textField: 'text',
            metadataField: 'metadata',
          },
        },
      },
    });

    // S3 Data Source for the Knowledge Base
    const dataSource = new bedrock.CfnDataSource(this, 'GuidelinesDataSource', {
      name: 'medical-guidelines-s3',
      description: 'Clinical guidelines, protocols, and formularies from S3',
      knowledgeBaseId: this.knowledgeBase.attrKnowledgeBaseId,
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: this.guidelinesBucket.bucketArn,
          inclusionPrefixes: ['guidelines/', 'protocols/', 'formularies/', 'dsm5/'],
        },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          // Hierarchical chunking: parent 1500 tokens, child 300 tokens
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

    // ── 4. Lambda: SaveHistoricalInteraction ───────────────────────────
    this.saveHistoricalInteractionFn = new lambda.Function(
      this,
      'SaveHistoricalInteractionFn',
      {
        functionName: 'clinical-save-historical-interaction',
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
        logRetention: logs.RetentionDays.ONE_MONTH,
      }
    );

    // DynamoDB write permission
    this.saveHistoricalInteractionFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [tableArn],
      })
    );

    // ── 5. EventBridge Rule: Connect CTR events ────────────────────────
    //
    // Amazon Connect emits Contact Trace Records via EventBridge.
    // Event source: aws.connect
    // Detail-type: Amazon Connect Contact Trace Record
    //
    // Contact Lens analysis (summaries, sentiment, categories) is embedded
    // in the CTR when Contact Lens is enabled on the queue.
    const ctrRule = new events.Rule(this, 'ConnectCTRRule', {
      ruleName: 'clinical-connect-ctr',
      description:
        'Fires on every Amazon Connect Contact Trace Record to persist ' +
        'Contact Lens summary to HistoricalInteraction table.',
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

    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: this.knowledgeBase.attrKnowledgeBaseId,
      description: 'Bedrock Knowledge Base ID (use in agent action groups)',
      exportName: 'ClinicalKnowledgeBaseId',
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseArn', {
      value: this.knowledgeBase.attrKnowledgeBaseArn,
      description: 'Bedrock Knowledge Base ARN',
      exportName: 'ClinicalKnowledgeBaseArn',
    });

    new cdk.CfnOutput(this, 'SaveHistoricalInteractionArn', {
      value: this.saveHistoricalInteractionFn.functionArn,
      description: 'Lambda that writes CTR summaries to HistoricalInteraction table',
      exportName: 'SaveHistoricalInteractionFnArn',
    });
  }
}
