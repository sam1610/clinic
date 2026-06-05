import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';

const bedrockClient = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || 'us-east-1' });

// Initialize OpenSearch client with AWS SigV4 signing
const getOpenSearchClient = async () => {
  const endpoint = process.env.OPENSEARCH_ENDPOINT!;
  const region = process.env.AWS_REGION || 'eu-central-1';

  return new Client({
    ...AwsSigv4Signer({
      region,
      service: 'aoss',
      getCredentials: () => {
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: `https://${endpoint}`,
  });
};

interface PatientSummaryRecord {
  id: string;
  summaryId: string;
  patientRecordId: string;
  summaryText: string;
  diagnosticSuggestions: string[];
  riskLevel: string;
  agentType: string;
  agentVersion: string;
  generatedAt: string;
  embeddingId?: string;
  similarCasesCount?: number;
}

/**
 * Lambda handler for vectorizing PatientSummary records
 * 
 * Triggered by: DynamoDB Stream on PatientSummary table
 * 
 * Process:
 * 1. Extract PatientSummary record from stream
 * 2. Generate embedding using Amazon Titan Text Embeddings
 * 3. Store embedding in OpenSearch with metadata
 * 4. Update DynamoDB record with embeddingId
 */
export const handler = async (event: DynamoDBStreamEvent): Promise<any> => {
  console.log('Received DynamoDB Stream event:', JSON.stringify(event, null, 2));

  const indexName = process.env.OPENSEARCH_INDEX || 'clinical-cases';
  const embeddingModelId = process.env.EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0';

  // Initialize OpenSearch client
  const osClient = await getOpenSearchClient();

  // Ensure index exists
  await ensureIndexExists(osClient, indexName);

  const results = [];

  for (const record of event.Records) {
    const eventName = record.eventName;

    // Process INSERT and MODIFY events
    if (eventName !== 'INSERT' && eventName !== 'MODIFY') {
      console.log(`Skipping event: ${eventName}`);
      continue;
    }

    const newImage = record.dynamodb?.NewImage;
    if (!newImage) {
      console.log('No new image found in record');
      continue;
    }

    try {
      // Deserialize DynamoDB record
      const summaryRecord = deserializeDynamoDBRecord(newImage);

      console.log(`Processing PatientSummary: ${summaryRecord.summaryId}`);

      // Generate embedding
      const embedding = await generateEmbedding(summaryRecord.summaryText, embeddingModelId);

      // Prepare document for OpenSearch
      const document = {
        embedding,
        summary_id: summaryRecord.summaryId,
        patient_record_id: summaryRecord.patientRecordId,
        summary_text: summaryRecord.summaryText,
        diagnostic_suggestions: summaryRecord.diagnosticSuggestions,
        risk_level: summaryRecord.riskLevel,
        agent_type: summaryRecord.agentType,
        agent_version: summaryRecord.agentVersion,
        generated_at: summaryRecord.generatedAt,
        dynamodb_record_id: summaryRecord.id, // Store original DynamoDB ID
        indexed_at: new Date().toISOString(),
      };

      // Index document in OpenSearch
      const response = await osClient.index({
        index: indexName,
        id: summaryRecord.summaryId,
        body: document,
        refresh: true,
      });

      console.log(`Indexed document in OpenSearch: ${summaryRecord.summaryId}`, response);

      results.push({
        summaryId: summaryRecord.summaryId,
        status: 'success',
        opensearchId: response.body._id,
      });

    } catch (error) {
      console.error('Error processing record:', error);
      results.push({
        summaryId: newImage.summaryId?.S || 'unknown',
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    batchItemFailures: results
      .filter((r) => r.status === 'error')
      .map((r) => ({ itemIdentifier: r.summaryId })),
  };
};

/**
 * Generate embedding using Amazon Titan Text Embeddings
 */
async function generateEmbedding(text: string, modelId: string): Promise<number[]> {
  console.log(`Generating embedding for text (length: ${text.length})`);

  // Titan Text Embeddings v2 supports up to 8192 tokens
  // Truncate if necessary (rough estimate: 1 token ≈ 4 characters)
  const maxChars = 30000;
  const truncatedText = text.length > maxChars ? text.substring(0, maxChars) : text;

  const input = {
    inputText: truncatedText,
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(input),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  // Titan returns embedding in 'embedding' field
  const embedding = responseBody.embedding;

  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Invalid embedding response from Bedrock');
  }

  console.log(`Generated embedding with dimension: ${embedding.length}`);

  return embedding;
}

/**
 * Ensure OpenSearch index exists with proper mapping
 */
async function ensureIndexExists(client: Client, indexName: string): Promise<void> {
  try {
    const exists = await client.indices.exists({ index: indexName });

    if (!exists.body) {
      console.log(`Creating index: ${indexName}`);

      await client.indices.create({
        index: indexName,
        body: {
          settings: {
            index: {
              knn: true,
              'knn.algo_param.ef_search': 512,
            },
          },
          mappings: {
            properties: {
              embedding: {
                type: 'knn_vector',
                dimension: 1024, // Titan Text Embeddings v2 dimension
                method: {
                  name: 'hnsw',
                  space_type: 'cosinesimil',
                  engine: 'nmslib',
                  parameters: {
                    ef_construction: 512,
                    m: 16,
                  },
                },
              },
              summary_id: { type: 'keyword' },
              patient_record_id: { type: 'keyword' },
              summary_text: { type: 'text' },
              diagnostic_suggestions: { type: 'keyword' },
              risk_level: { type: 'keyword' },
              agent_type: { type: 'keyword' },
              agent_version: { type: 'keyword' },
              generated_at: { type: 'date' },
              dynamodb_record_id: { type: 'keyword' },
              indexed_at: { type: 'date' },
            },
          },
        },
      });

      console.log(`Index created: ${indexName}`);
    } else {
      console.log(`Index already exists: ${indexName}`);
    }
  } catch (error) {
    console.error('Error ensuring index exists:', error);
    throw error;
  }
}

/**
 * Deserialize DynamoDB Stream record
 */
function deserializeDynamoDBRecord(image: any): PatientSummaryRecord {
  return {
    id: image.id?.S || '',
    summaryId: image.summaryId?.S || '',
    patientRecordId: image.patientRecordId?.S || '',
    summaryText: image.summaryText?.S || '',
    diagnosticSuggestions: image.diagnosticSuggestions?.L?.map((item: any) => item.S) || [],
    riskLevel: image.riskLevel?.S || 'Medium',
    agentType: image.agentType?.S || '',
    agentVersion: image.agentVersion?.S || '',
    generatedAt: image.generatedAt?.S || new Date().toISOString(),
    embeddingId: image.embeddingId?.S,
    similarCasesCount: image.similarCasesCount?.N ? parseInt(image.similarCasesCount.N) : undefined,
  };
}
