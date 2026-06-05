import * as cdk from 'aws-cdk-lib';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as path from 'path';

export interface VectorSearchStackProps extends cdk.StackProps {
  /**
   * DynamoDB table name for PatientSummary (from Amplify Gen 2)
   */
  patientSummaryTableName?: string;

  /**
   * DynamoDB table ARN for PatientSummary
   */
  patientSummaryTableArn?: string;

  /**
   * DynamoDB Stream ARN for PatientSummary
   */
  patientSummaryStreamArn?: string;
}

export class VectorSearchStack extends cdk.Stack {
  public readonly collection: opensearchserverless.CfnCollection;
  public readonly ingestionFunction: lambda.Function;
  public readonly collectionEndpoint: string;

  constructor(scope: Construct, id: string, props?: VectorSearchStackProps) {
    super(scope, id, props);

    // ========================================
    // OpenSearch Serverless Collection
    // ========================================

    // Create encryption policy
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(
      this,
      'EncryptionPolicy',
      {
        name: 'clinical-cases-encryption',
        type: 'encryption',
        policy: JSON.stringify({
          Rules: [
            {
              ResourceType: 'collection',
              Resource: ['collection/clinical-cases'],
            },
          ],
          AWSOwnedKey: true,
        }),
      }
    );

    // Create network policy (allow public access for now, restrict in production)
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(
      this,
      'NetworkPolicy',
      {
        name: 'clinical-cases-network',
        type: 'network',
        policy: JSON.stringify([
          {
            Rules: [
              {
                ResourceType: 'collection',
                Resource: ['collection/clinical-cases'],
              },
              {
                ResourceType: 'dashboard',
                Resource: ['collection/clinical-cases'],
              },
            ],
            AllowFromPublic: true,
          },
        ]),
      }
    );

    // Create the OpenSearch Serverless collection
    this.collection = new opensearchserverless.CfnCollection(this, 'ClinicalCasesCollection', {
      name: 'clinical-cases',
      type: 'VECTORSEARCH',
      description: 'Vector search collection for clinical case similarity',
    });

    this.collection.addDependency(encryptionPolicy);
    this.collection.addDependency(networkPolicy);

    // Store collection endpoint
    this.collectionEndpoint = this.collection.attrCollectionEndpoint;

    // ========================================
    // Lambda Function: Vector Ingestion
    // ========================================

    this.ingestionFunction = new lambda.Function(this, 'VectorIngestionFunction', {
      functionName: 'clinical-vector-ingestion',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../functions/vector-ingestion')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        OPENSEARCH_ENDPOINT: this.collectionEndpoint,
        OPENSEARCH_INDEX: 'clinical-cases',
        BEDROCK_REGION: 'us-east-1',
        EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Grant Bedrock permissions for embeddings
    this.ingestionFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      })
    );

    // Grant OpenSearch Serverless permissions
    this.ingestionFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: [this.collection.attrArn],
      })
    );

    // Create data access policy for Lambda
    const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(
      this,
      'DataAccessPolicy',
      {
        name: 'clinical-cases-data-access',
        type: 'data',
        policy: JSON.stringify([
          {
            Rules: [
              {
                ResourceType: 'collection',
                Resource: ['collection/clinical-cases'],
                Permission: [
                  'aoss:CreateCollectionItems',
                  'aoss:UpdateCollectionItems',
                  'aoss:DescribeCollectionItems',
                ],
              },
              {
                ResourceType: 'index',
                Resource: ['index/clinical-cases/*'],
                Permission: [
                  'aoss:CreateIndex',
                  'aoss:DescribeIndex',
                  'aoss:ReadDocument',
                  'aoss:WriteDocument',
                  'aoss:UpdateIndex',
                  'aoss:DeleteIndex',
                ],
              },
            ],
            Principal: [this.ingestionFunction.role!.roleArn],
          },
        ]),
      }
    );

    dataAccessPolicy.addDependency(this.collection);

    // ========================================
    // DynamoDB Stream Trigger
    // ========================================

    if (props?.patientSummaryStreamArn) {
      // Import existing DynamoDB table
      const patientSummaryTable = dynamodb.Table.fromTableAttributes(
        this,
        'PatientSummaryTable',
        {
          tableArn: props.patientSummaryTableArn!,
          tableStreamArn: props.patientSummaryStreamArn,
        }
      );

      // Add DynamoDB Stream as event source
      this.ingestionFunction.addEventSource(
        new DynamoEventSource(patientSummaryTable, {
          startingPosition: lambda.StartingPosition.LATEST,
          batchSize: 10,
          retryAttempts: 2,
          bisectBatchOnError: true,
          reportBatchItemFailures: true,
        })
      );

      // Grant read permissions on the stream
      patientSummaryTable.grantStreamRead(this.ingestionFunction);
    }

    // ========================================
    // Outputs
    // ========================================

    new cdk.CfnOutput(this, 'CollectionEndpoint', {
      value: this.collectionEndpoint,
      description: 'OpenSearch Serverless collection endpoint',
      exportName: 'ClinicalCasesCollectionEndpoint',
    });

    new cdk.CfnOutput(this, 'CollectionArn', {
      value: this.collection.attrArn,
      description: 'OpenSearch Serverless collection ARN',
      exportName: 'ClinicalCasesCollectionArn',
    });

    new cdk.CfnOutput(this, 'IngestionFunctionArn', {
      value: this.ingestionFunction.functionArn,
      description: 'Vector ingestion Lambda function ARN',
      exportName: 'VectorIngestionFunctionArn',
    });

    new cdk.CfnOutput(this, 'IndexName', {
      value: 'clinical-cases',
      description: 'OpenSearch index name',
      exportName: 'ClinicalCasesIndexName',
    });
  }
}
