import {
  ComprehendMedicalClient,
  DetectEntitiesV2Command,
  Entity,
} from '@aws-sdk/client-comprehendmedical';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { EventBridgeEvent } from 'aws-lambda';
import { Readable } from 'stream';

const comprehendClient = new ComprehendMedicalClient({});
const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});

interface TranscribeJobStateChange {
  TranscriptionJobName: string;
  TranscriptionJobStatus: string;
  OutputDataConfig?: {
    S3Uri: string;
  };
  Media?: {
    MediaFileUri: string;
  };
  StartTime?: string;
  CompletionTime?: string;
}

interface TranscriptResult {
  jobName: string;
  accountId: string;
  results: {
    transcripts: Array<{
      transcript: string;
    }>;
    items: Array<{
      start_time?: string;
      end_time?: string;
      alternatives: Array<{
        confidence: string;
        content: string;
      }>;
      type: string;
    }>;
  };
  status: string;
}

/**
 * Lambda handler for processing transcripts with Comprehend Medical
 * 
 * Triggered by: EventBridge rule when Transcribe Medical job completes
 * 
 * Process:
 * 1. Fetch transcript from S3
 * 2. Extract medical entities using Comprehend Medical
 * 3. Write transcript to ClinicalInteraction table
 * 4. Write entities to ClinicalEntities table
 */
export const handler = async (
  event: EventBridgeEvent<'Transcribe Medical Job State Change', TranscribeJobStateChange>
): Promise<void> => {
  console.log('Received Transcribe job completion event:', JSON.stringify(event, null, 2));

  const jobName = event.detail.TranscriptionJobName;
  const outputS3Uri = event.detail.OutputDataConfig?.S3Uri;

  if (!outputS3Uri) {
    throw new Error('No output S3 URI found in event');
  }

  // Parse S3 URI
  const s3UriMatch = outputS3Uri.match(/s3:\/\/([^\/]+)\/(.+)/);
  if (!s3UriMatch) {
    throw new Error(`Invalid S3 URI format: ${outputS3Uri}`);
  }

  const [, bucketName, objectKey] = s3UriMatch;

  console.log(`Fetching transcript from s3://${bucketName}/${objectKey}`);

  try {
    // ========================================
    // Step 1: Fetch transcript from S3
    // ========================================
    const getObjectCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
    });

    const s3Response = await s3Client.send(getObjectCommand);
    const transcriptJson = await streamToString(s3Response.Body as Readable);
    const transcript: TranscriptResult = JSON.parse(transcriptJson);

    const fullTranscript = transcript.results.transcripts[0]?.transcript || '';

    if (!fullTranscript) {
      console.warn('Empty transcript received');
      return;
    }

    console.log(`Transcript length: ${fullTranscript.length} characters`);

    // ========================================
    // Step 2: Extract entities with Comprehend Medical
    // ========================================
    console.log('Detecting medical entities...');

    const detectEntitiesCommand = new DetectEntitiesV2Command({
      Text: fullTranscript,
    });

    const comprehendResponse = await comprehendClient.send(detectEntitiesCommand);
    const entities = comprehendResponse.Entities || [];

    console.log(`Detected ${entities.length} medical entities`);

    // Categorize entities
    const symptoms = extractEntitiesByCategory(entities, 'MEDICAL_CONDITION');
    const medications = extractEntitiesByCategory(entities, 'MEDICATION');
    const procedures = extractEntitiesByCategory(entities, 'PROCEDURE');
    const conditions = extractEntitiesByCategory(entities, 'DX_NAME');

    console.log('Entity summary:', {
      symptoms: symptoms.length,
      medications: medications.length,
      procedures: procedures.length,
      conditions: conditions.length,
    });

    // ========================================
    // Step 3: Extract metadata from job name
    // ========================================
    // Expected format: medical-transcription-recordings-{contactId}-{timestamp}
    const contactId = extractContactIdFromJobName(jobName);
    const interactionId = `INT-${Date.now()}`;
    const entityId = `ENT-${Date.now()}`;

    // ========================================
    // Step 4: Write to DynamoDB - ClinicalInteraction
    // ========================================
    const clinicalInteractionTable = process.env.CLINICAL_INTERACTION_TABLE!;

    const interactionItem = {
      id: interactionId,
      interactionId: interactionId,
      patientRecordId: 'UNKNOWN', // Will be updated by Connect integration
      audioS3Uri: event.detail.Media?.MediaFileUri || '',
      transcriptText: fullTranscript,
      channel: 'Voice',
      startTime: event.detail.StartTime || new Date().toISOString(),
      endTime: event.detail.CompletionTime || new Date().toISOString(),
      duration: 0, // Calculate from start/end time if needed
      connectContactId: contactId,
      agentId: 'SYSTEM',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      __typename: 'ClinicalInteraction',
    };

    console.log(`Writing to ${clinicalInteractionTable}:`, interactionId);

    await dynamoClient.send(
      new PutItemCommand({
        TableName: clinicalInteractionTable,
        Item: marshall(interactionItem, { removeUndefinedValues: true }),
      })
    );

    // ========================================
    // Step 5: Write to DynamoDB - ClinicalEntities
    // ========================================
    const clinicalEntitiesTable = process.env.CLINICAL_ENTITIES_TABLE!;

    const entitiesItem = {
      id: entityId,
      entityId: entityId,
      clinicalInteractionId: interactionId,
      entitiesJson: comprehendResponse,
      symptoms,
      medications,
      conditions,
      procedures,
      extractedAt: new Date().toISOString(),
      comprehendJobId: jobName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      __typename: 'ClinicalEntities',
    };

    console.log(`Writing to ${clinicalEntitiesTable}:`, entityId);

    await dynamoClient.send(
      new PutItemCommand({
        TableName: clinicalEntitiesTable,
        Item: marshall(entitiesItem, { removeUndefinedValues: true }),
      })
    );

    console.log('Successfully processed transcript and entities');
  } catch (error) {
    console.error('Error processing transcript:', error);
    throw error;
  }
};

/**
 * Helper: Convert stream to string
 */
async function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

/**
 * Helper: Extract entities by category
 */
function extractEntitiesByCategory(entities: Entity[], category: string): string[] {
  return entities
    .filter((entity) => entity.Category === category)
    .map((entity) => entity.Text || '')
    .filter((text) => text.length > 0);
}

/**
 * Helper: Extract contact ID from job name
 */
function extractContactIdFromJobName(jobName: string): string {
  // Expected format: medical-transcription-recordings-{contactId}-{timestamp}
  const parts = jobName.split('-');
  if (parts.length >= 4) {
    return parts[3]; // contactId
  }
  return 'UNKNOWN';
}
